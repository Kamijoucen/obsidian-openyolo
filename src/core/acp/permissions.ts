import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk'

export type PermissionRespondHook = {
  onPending: (params: RequestPermissionRequest) => void
  onSettled: (sessionId: string, toolCallId: string) => void
}

type PendingEntry = {
  resolve: (response: RequestPermissionResponse) => void
  signal?: AbortSignal
  onAbort?: () => void
}

function selectedResponse(optionId: string): RequestPermissionResponse {
  return { outcome: { outcome: 'selected', optionId } }
}

function cancelledResponse(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } }
}

export class PermissionManager {
  private pending = new Map<string, Map<string, PendingEntry>>()

  handleRequest(
    params: RequestPermissionRequest,
    hooks: PermissionRespondHook,
    signal?: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    const sessionId = params.sessionId
    const toolCallId = params.toolCall.toolCallId
    this.settlePending(sessionId, toolCallId, cancelledResponse())
    if (signal?.aborted) return Promise.resolve(cancelledResponse())
    return new Promise<RequestPermissionResponse>((resolve, reject) => {
      let sessionPending = this.pending.get(sessionId)
      if (!sessionPending) {
        sessionPending = new Map<string, PendingEntry>()
        this.pending.set(sessionId, sessionPending)
      }
      const entry: PendingEntry = {
        resolve: (response) => {
          resolve(response)
          hooks.onSettled(sessionId, toolCallId)
        },
        signal,
      }
      if (signal) {
        entry.onAbort = () => {
          this.settleEntry(sessionId, toolCallId, entry, cancelledResponse())
        }
        signal.addEventListener('abort', entry.onAbort, { once: true })
      }
      sessionPending.set(toolCallId, entry)
      if (signal?.aborted) {
        entry.onAbort?.()
        return
      }
      try {
        hooks.onPending(params)
      } catch (error) {
        const current = this.pending.get(sessionId)?.get(toolCallId)
        if (current === entry) {
          sessionPending.delete(toolCallId)
          if (sessionPending.size === 0) this.pending.delete(sessionId)
          this.removeAbortListener(entry)
          hooks.onSettled(sessionId, toolCallId)
        }
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  respond(sessionId: string, toolCallId: string, optionId: string): boolean {
    return this.settlePending(sessionId, toolCallId, selectedResponse(optionId))
  }

  cancelSession(sessionId: string): void {
    const sessionPending = this.pending.get(sessionId)
    if (!sessionPending) return
    this.pending.delete(sessionId)
    for (const entry of sessionPending.values()) {
      this.removeAbortListener(entry)
      entry.resolve(cancelledResponse())
    }
  }

  cancelAll(): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const sessionPending of pending) {
      for (const entry of sessionPending.values()) {
        this.removeAbortListener(entry)
        entry.resolve(cancelledResponse())
      }
    }
  }

  hasPending(sessionId: string, toolCallId: string): boolean {
    return this.pending.get(sessionId)?.has(toolCallId) ?? false
  }

  private settlePending(
    sessionId: string,
    toolCallId: string,
    response: RequestPermissionResponse,
  ): boolean {
    const sessionPending = this.pending.get(sessionId)
    const entry = sessionPending?.get(toolCallId)
    if (!sessionPending || !entry) return false
    sessionPending.delete(toolCallId)
    if (sessionPending.size === 0) this.pending.delete(sessionId)
    this.removeAbortListener(entry)
    entry.resolve(response)
    return true
  }

  private settleEntry(
    sessionId: string,
    toolCallId: string,
    expected: PendingEntry,
    response: RequestPermissionResponse,
  ): boolean {
    const current = this.pending.get(sessionId)?.get(toolCallId)
    if (current !== expected) return false
    return this.settlePending(sessionId, toolCallId, response)
  }

  private removeAbortListener(entry: PendingEntry) {
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort)
    }
  }
}
