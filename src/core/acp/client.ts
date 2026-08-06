import * as acp from '@agentclientprotocol/sdk'
import type {
  AgentCapabilities,
  Implementation,
  RequestPermissionRequest,
  SendRequestOptions,
  SessionNotification,
} from '@agentclientprotocol/sdk'

import type { FsBridge } from './fsBridge'
import type { PermissionManager } from './permissions'
import { resolveOpencodeBinary, spawnOpencodeAcp } from './process'
import type { SpawnedProcess } from './process'
import { nodeReadableToWeb, nodeWritableToWeb } from './streams'
import { cancelTimeout, scheduleTimeout } from './timers'
import type { TimerHandle } from './timers'

const INITIALIZE_TIMEOUT_MS = 30_000
const PROCESS_EXIT_GRACE_MS = 2_000
const PROCESS_KILL_GRACE_MS = 1_000

export type AcpClientOptions = {
  configuredPath: string
  extraArgs: string[]
  cwd: string
  clientName: string
  clientVersion: string
}

export type AcpAgentPort = {
  request<T>(
    method: string,
    params?: unknown,
    options?: SendRequestOptions,
  ): Promise<T>
  notify(method: string, params?: unknown): Promise<void>
}

export type AcpDisconnectReason =
  | { kind: 'connection-closed'; error: unknown }
  | { kind: 'process-exit'; code: number | null; signal: string | null }

export type AcpClientHooks = {
  fsBridge: FsBridge
  permissionManager: PermissionManager
  isSessionActive?: (sessionId: string) => boolean
  canRequestPermission?: (params: RequestPermissionRequest) => boolean
  onSessionUpdate: (notification: SessionNotification) => void
  onPermissionPending: (params: RequestPermissionRequest) => void
  onPermissionSettled: (sessionId: string, toolCallId: string) => void
  onStderr?: (line: string) => void
  onDebug?: (event: string, payload: unknown) => void
  onDisconnected?: (reason: AcpDisconnectReason) => void
}

export type AcpClientPort = {
  readonly agentInfo: Implementation | null
  readonly agentCapabilities: AgentCapabilities
  readonly isConnected: boolean
  connect(hooks: AcpClientHooks): Promise<void>
  agent(): AcpAgentPort
  dispose(reason?: unknown): Promise<void>
}

export type AcpClientFactory = (options: AcpClientOptions) => AcpClientPort

export class OpencodeNotFoundError extends Error {
  constructor() {
    super('opencode binary not found')
    this.name = 'OpencodeNotFoundError'
  }
}

export class AcpTimeoutError extends Error {
  constructor(operation: string) {
    super(`${operation} timed out`)
    this.name = 'AcpTimeoutError'
  }
}

function waitForProcessExit(
  child: SpawnedProcess,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = scheduleTimeout(() => resolve(false), timeoutMs)
    void child.exited.then(() => {
      cancelTimeout(timer)
      resolve(true)
    })
  })
}

async function stopProcess(child: SpawnedProcess): Promise<void> {
  child.closeStdin()
  if (await waitForProcessExit(child, PROCESS_EXIT_GRACE_MS)) return
  child.kill('SIGTERM')
  if (await waitForProcessExit(child, PROCESS_KILL_GRACE_MS)) return
  child.kill('SIGKILL')
  await child.exited
}

async function withRequestTimeout<T>(
  operation: string,
  timeoutMs: number,
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: TimerHandle | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = scheduleTimeout(() => {
      const error = new AcpTimeoutError(operation)
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([request(controller.signal), timeout])
  } finally {
    if (timer !== null) cancelTimeout(timer)
  }
}

export class AcpClient implements AcpClientPort {
  private connection: acp.ClientConnection | null = null
  private child: SpawnedProcess | null = null
  private agentInfoValue: Implementation | null = null
  private agentCapabilitiesValue: AgentCapabilities = {}
  private initialized = false
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private processStopPromise: Promise<void> | null = null
  private connectPromise: Promise<void> | null = null

  constructor(private readonly options: AcpClientOptions) {}

  get agentInfo(): Implementation | null {
    return this.agentInfoValue
  }

  get agentCapabilities(): AgentCapabilities {
    return this.agentCapabilitiesValue
  }

  get isConnected(): boolean {
    return (
      this.initialized &&
      this.connection !== null &&
      !this.connection.signal.aborted
    )
  }

  async connect(hooks: AcpClientHooks): Promise<void> {
    if (this.isConnected) return
    if (this.disposed) throw new Error('ACP client has been disposed')
    if (this.connectPromise || this.connection || this.child) {
      throw new Error('ACP client is already connecting')
    }

    const connecting = this.connectInternal(hooks)
    this.connectPromise = connecting
    try {
      await connecting
    } finally {
      if (this.connectPromise === connecting) this.connectPromise = null
    }
  }

  private async connectInternal(hooks: AcpClientHooks): Promise<void> {
    try {
      const binary = await resolveOpencodeBinary(this.options.configuredPath)
      if (!binary) throw new OpencodeNotFoundError()
      if (this.disposed)
        throw new Error('ACP client was disposed while starting')

      const child = await spawnOpencodeAcp({
        binary,
        args: this.options.extraArgs,
        cwd: this.options.cwd,
      })
      if (this.disposed) {
        await this.stopChild(child)
        throw new Error('ACP client was disposed while starting')
      }
      this.child = child

      let disconnectReported = false
      const reportDisconnect = (reason: AcpDisconnectReason) => {
        if (disconnectReported || this.disposed || !this.initialized) return
        disconnectReported = true
        hooks.onDisconnected?.(reason)
      }

      child.onExit((code, signal) => {
        if (this.child !== child) return
        const connection = this.connection
        reportDisconnect({ kind: 'process-exit', code, signal })
        this.child = null
        this.connection = null
        this.initialized = false
        connection?.close(
          new Error(
            `opencode exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
          ),
        )
      })

      if (hooks.onStderr) {
        let buffer = ''
        child.stderr.on('data', (chunk: Buffer | string) => {
          buffer += chunk.toString()
          let index = buffer.indexOf('\n')
          while (index >= 0) {
            const line = buffer.slice(0, index).trim()
            buffer = buffer.slice(index + 1)
            if (line) hooks.onStderr?.(line)
            index = buffer.indexOf('\n')
          }
        })
      }

      const stream = acp.ndJsonStream(
        nodeWritableToWeb(child.stdin),
        nodeReadableToWeb(child.stdout),
      )
      const app = acp
        .client({ name: this.options.clientName })
        .onNotification('session/update', ({ params }) => {
          hooks.onSessionUpdate(params)
        })
        .onRequest('session/request_permission', ({ params, signal }) => {
          if (
            hooks.canRequestPermission &&
            !hooks.canRequestPermission(params)
          ) {
            return { outcome: { outcome: 'cancelled' as const } }
          }
          return hooks.permissionManager.handleRequest(
            params,
            {
              onPending: hooks.onPermissionPending,
              onSettled: hooks.onPermissionSettled,
            },
            signal,
          )
        })
        .onRequest('fs/read_text_file', ({ params }) => {
          hooks.onDebug?.('fs/read_text_file', params)
          if (
            hooks.isSessionActive &&
            !hooks.isSessionActive(params.sessionId)
          ) {
            throw new Error(`Unknown ACP session: ${params.sessionId}`)
          }
          return hooks.fsBridge.readTextFile(params)
        })
        .onRequest('fs/write_text_file', ({ params }) => {
          hooks.onDebug?.('fs/write_text_file', params)
          if (
            hooks.isSessionActive &&
            !hooks.isSessionActive(params.sessionId)
          ) {
            throw new Error(`Unknown ACP session: ${params.sessionId}`)
          }
          return hooks.fsBridge.writeTextFile(params)
        })
      const connection = app.connect(stream)
      this.connection = connection
      void connection.closed.then(() => {
        if (this.connection !== connection) return
        const reason: unknown = connection.signal.reason
        const error = reason ?? new Error('ACP connection closed')
        reportDisconnect({ kind: 'connection-closed', error })
        this.connection = null
        this.initialized = false
        const activeChild = this.child
        if (activeChild === child) {
          this.child = null
          void this.stopChild(activeChild)
        }
      })

      const initResponse = await withRequestTimeout(
        'ACP initialize',
        INITIALIZE_TIMEOUT_MS,
        (signal) =>
          connection.agent.request(
            'initialize',
            {
              protocolVersion: acp.PROTOCOL_VERSION,
              clientCapabilities: {
                fs: { readTextFile: true, writeTextFile: true },
                terminal: false,
              },
              clientInfo: {
                name: this.options.clientName,
                version: this.options.clientVersion,
              },
            },
            { cancellationSignal: signal },
          ),
      )
      if (initResponse.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw new Error(
          `Unsupported ACP protocol version: ${initResponse.protocolVersion}`,
        )
      }
      if (
        this.disposed ||
        this.connection !== connection ||
        connection.signal.aborted
      ) {
        throw new Error('ACP connection closed during initialization')
      }
      this.agentInfoValue = initResponse.agentInfo ?? null
      this.agentCapabilitiesValue = initResponse.agentCapabilities ?? {}
      this.initialized = true
      hooks.onDebug?.('initialize', initResponse)
    } catch (error) {
      this.disposed = true
      await this.cleanup(error)
      throw error
    }
  }

  private stopChild(child: SpawnedProcess): Promise<void> {
    this.processStopPromise ??= stopProcess(child)
    return this.processStopPromise
  }

  private async cleanup(reason: unknown): Promise<void> {
    this.initialized = false
    const connection = this.connection
    const child = this.child
    this.connection = null
    this.child = null
    connection?.close(reason)
    if (child) return this.stopChild(child)
    await this.processStopPromise
  }

  agent(): AcpAgentPort {
    const connection = this.connection
    if (!this.initialized || !connection || connection.signal.aborted) {
      throw new Error('ACP client is not connected')
    }
    return {
      request: <T>(
        method: string,
        params?: unknown,
        options?: SendRequestOptions,
      ) => connection.agent.request<T>(method, params, options),
      notify: (method: string, params?: unknown) =>
        connection.agent.notify(method, params),
    }
  }

  async dispose(
    reason: unknown = new Error('ACP client disposed'),
  ): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    const connecting = this.connectPromise
    const cleanup = this.cleanup(reason)
    this.disposePromise = Promise.allSettled([
      cleanup,
      connecting ?? Promise.resolve(),
    ]).then(() => undefined)
    return this.disposePromise
  }
}
