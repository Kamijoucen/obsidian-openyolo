import type { RequestPermissionRequest } from '@agentclientprotocol/sdk'

import { PermissionManager } from './permissions'

const options: RequestPermissionRequest['options'] = [
  { optionId: 'once', kind: 'allow_once' as const, name: 'Allow once' },
  { optionId: 'always', kind: 'allow_always' as const, name: 'Always allow' },
  { optionId: 'reject', kind: 'reject_once' as const, name: 'Reject' },
]

function makeRequest(
  sessionId = 's1',
  toolCallId = 't1',
  requestOptions: RequestPermissionRequest['options'] = options,
): RequestPermissionRequest {
  return {
    sessionId,
    toolCall: { toolCallId, title: 'edit', kind: 'edit' },
    options: requestOptions,
  }
}

const noopHooks = {
  onPending: () => undefined,
  onSettled: () => undefined,
}

describe('PermissionManager', () => {
  it('auto-approves with allow_once when enabled', async () => {
    const manager = new PermissionManager(() => true)
    const response = await manager.handleRequest(makeRequest(), noopHooks)
    expect(response).toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    })
  })

  it('waits for user response when auto-approve is off', async () => {
    const manager = new PermissionManager(() => false)
    const captured: RequestPermissionRequest[] = []
    const settled: Array<[string, string]> = []
    const promise = manager.handleRequest(makeRequest(), {
      onPending: (params) => {
        captured.push(params)
      },
      onSettled: (sessionId, toolCallId) => {
        settled.push([sessionId, toolCallId])
      },
    })
    expect(captured[0]?.toolCall.toolCallId).toBe('t1')
    expect(manager.hasPending('s1', 't1')).toBe(true)

    const resolved = manager.respond('s1', 't1', 'always')
    expect(resolved).toBe(true)
    await expect(promise).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'always' },
    })
    expect(settled).toEqual([['s1', 't1']])
    expect(manager.hasPending('s1', 't1')).toBe(false)
  })

  it('uses sessionId to scope identical toolCallIds', async () => {
    const manager = new PermissionManager(() => false)
    const first = manager.handleRequest(makeRequest('s1', 'shared'), noopHooks)
    const second = manager.handleRequest(makeRequest('s2', 'shared'), noopHooks)

    expect(manager.hasPending('s1', 'shared')).toBe(true)
    expect(manager.hasPending('s2', 'shared')).toBe(true)
    expect(manager.respond('s1', 'shared', 'once')).toBe(true)
    await expect(first).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    })
    expect(manager.hasPending('s2', 'shared')).toBe(true)

    expect(manager.respond('s2', 'shared', 'reject')).toBe(true)
    await expect(second).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    })
  })

  it('cancels an older request with the same composite key', async () => {
    const manager = new PermissionManager(() => false)
    const events: string[] = []
    const hooks = {
      onPending: (params: RequestPermissionRequest) => {
        events.push(`pending:${params.sessionId}:${params.toolCall.toolCallId}`)
      },
      onSettled: (sessionId: string, toolCallId: string) => {
        events.push(`settled:${sessionId}:${toolCallId}`)
      },
    }
    const first = manager.handleRequest(makeRequest(), hooks)
    const replacement = manager.handleRequest(makeRequest(), hooks)

    await expect(first).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(events).toEqual(['pending:s1:t1', 'settled:s1:t1', 'pending:s1:t1'])
    expect(manager.hasPending('s1', 't1')).toBe(true)

    expect(manager.respond('s1', 't1', 'once')).toBe(true)
    await expect(replacement).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    })
  })

  it('does not auto-approve without an allow_once option', async () => {
    const manager = new PermissionManager(() => true)
    const onPending = jest.fn()
    const promise = manager.handleRequest(
      makeRequest('s1', 't1', [
        { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ]),
      { onPending, onSettled: () => undefined },
    )

    expect(onPending).toHaveBeenCalledTimes(1)
    expect(manager.hasPending('s1', 't1')).toBe(true)
    expect(manager.respond('s1', 't1', 'reject')).toBe(true)
    await expect(promise).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    })
  })

  it('cancels pending requests for a session', async () => {
    const manager = new PermissionManager(() => false)
    const promise = manager.handleRequest(
      makeRequest('s1', 'shared'),
      noopHooks,
    )
    const other = manager.handleRequest(makeRequest('s2', 'shared'), noopHooks)
    manager.cancelSession('s1')
    await expect(promise).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    })
    expect(manager.hasPending('s1', 'shared')).toBe(false)
    expect(manager.hasPending('s2', 'shared')).toBe(true)
    expect(manager.respond('s2', 'shared', 'once')).toBe(true)
    await expect(other).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    })
  })

  it('cancelAll resolves every pending request', async () => {
    const manager = new PermissionManager(() => false)
    const p1 = manager.handleRequest(makeRequest('s1', 't1'), noopHooks)
    const p2 = manager.handleRequest(makeRequest('s2', 't2'), noopHooks)
    manager.cancelAll()
    await expect(p1).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    await expect(p2).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    expect(manager.hasPending('s1', 't1')).toBe(false)
    expect(manager.hasPending('s2', 't2')).toBe(false)
  })

  it('respond returns false for unknown toolCallId', () => {
    const manager = new PermissionManager(() => false)
    expect(manager.respond('s1', 'nope', 'once')).toBe(false)
  })

  it('allows an onPending hook to respond synchronously', async () => {
    const manager = new PermissionManager(() => false)
    const promise = manager.handleRequest(makeRequest(), {
      onPending: () => {
        expect(manager.respond('s1', 't1', 'once')).toBe(true)
      },
      onSettled: () => undefined,
    })

    await expect(promise).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'once' },
    })
  })

  it('settles when the signal aborts from the onPending hook', async () => {
    const manager = new PermissionManager(() => false)
    const controller = new AbortController()
    const promise = manager.handleRequest(
      makeRequest(),
      {
        onPending: () => controller.abort(),
        onSettled: () => undefined,
      },
      controller.signal,
    )

    await expect(promise).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    })
    expect(manager.hasPending('s1', 't1')).toBe(false)
  })

  it('cleans up when the onPending hook throws', async () => {
    const manager = new PermissionManager(() => false)
    const onSettled = jest.fn()
    const promise = manager.handleRequest(makeRequest(), {
      onPending: () => {
        throw new Error('render failed')
      },
      onSettled,
    })

    await expect(promise).rejects.toThrow('render failed')
    expect(manager.hasPending('s1', 't1')).toBe(false)
    expect(onSettled).toHaveBeenCalledWith('s1', 't1')
  })
})
