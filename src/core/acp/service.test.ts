import type {
  AgentCapabilities,
  ContentBlock,
  Implementation,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  SendRequestOptions,
} from '@agentclientprotocol/sdk'
import type { App } from 'obsidian'

import type { YoloSettings } from '../../settings/schema/setting.types'

import type {
  AcpAgentPort,
  AcpClientHooks,
  AcpClientOptions,
  AcpClientPort,
  AcpDisconnectReason,
} from './client'
import { AcpSessionService } from './service'

jest.mock('@agentclientprotocol/sdk', () => ({}))
jest.mock('./process', () => ({
  resolveOpencodeBinary: jest.fn(),
  spawnOpencodeAcp: jest.fn(),
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

type RequestRecord = {
  method: string
  params: unknown
  options: SendRequestOptions | undefined
}

const OPENCODE_CAPABILITIES: AgentCapabilities = {
  loadSession: true,
  sessionCapabilities: {
    list: {},
    resume: {},
    close: {},
  },
}

const SETTINGS: YoloSettings = {
  opencodePath: '',
  opencodeArgs: [],
  defaultMode: 'build',
  autoApprovePermissions: false,
  showReasoning: true,
  debugLog: false,
  systemPrompt: '',
  manageAgentsMd: false,
  savedConfigSelections: {},
}

const APP = {
  vault: { adapter: { getBasePath: () => '/vault' } },
} as unknown as App

const PROMPT: ContentBlock[] = [{ type: 'text', text: 'hello' }]

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve()
  }
}

class FakeClient implements AcpClientPort {
  readonly agentInfo: Implementation
  readonly agentCapabilities: AgentCapabilities
  readonly requests: RequestRecord[] = []
  readonly notifications: Array<{ method: string; params: unknown }> = []
  private connected = false
  private hooks: AcpClientHooks | null = null
  private queuedResponses = new Map<string, unknown[]>()
  private sessionSequence = 0
  private disposePromise: Promise<void> | null = null

  constructor(
    readonly name: string,
    private readonly connectGate: Deferred<undefined> | null = null,
    agentCapabilities: AgentCapabilities = OPENCODE_CAPABILITIES,
    private readonly disposeGate: Deferred<undefined> | null = null,
    private readonly cooperativeCancellation = true,
  ) {
    this.agentInfo = { name, version: '1.18.14' }
    this.agentCapabilities = agentCapabilities
  }

  get isConnected(): boolean {
    return this.connected
  }

  readonly connect = jest.fn(async (hooks: AcpClientHooks): Promise<void> => {
    this.hooks = hooks
    if (this.connectGate) await this.connectGate.promise
    this.connected = true
  })

  agent(): AcpAgentPort {
    if (!this.connected) throw new Error('Fake ACP client is not connected')
    return {
      request: <T>(
        method: string,
        params?: unknown,
        options?: SendRequestOptions,
      ) => this.request<T>(method, params, options),
      notify: (method: string, params?: unknown) => this.notify(method, params),
    }
  }

  readonly dispose = jest.fn((_reason?: unknown): Promise<void> => {
    this.connected = false
    this.disposePromise ??= this.disposeGate?.promise ?? Promise.resolve()
    return this.disposePromise
  })

  queueResponse(method: string, response: unknown): void {
    const queued = this.queuedResponses.get(method) ?? []
    queued.push(response)
    this.queuedResponses.set(method, queued)
  }

  countRequests(method: string): number {
    return this.requests.filter((request) => request.method === method).length
  }

  emitDisconnect(reason: AcpDisconnectReason): void {
    this.connected = false
    this.hooks?.onDisconnected?.(reason)
  }

  private request<T>(
    method: string,
    params?: unknown,
    options?: SendRequestOptions,
  ): Promise<T> {
    this.requests.push({ method, params, options })
    const queued = this.queuedResponses.get(method)
    const response =
      queued && queued.length > 0
        ? queued.shift()
        : this.defaultResponse(method)
    const pending =
      response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response).then((value) => value as T)
    const signal = options?.cancellationSignal
    if (!signal || !this.cooperativeCancellation) return pending
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        const reason = signal.reason
        reject(
          reason instanceof Error ? reason : new Error('Request cancelled'),
        )
      }
      if (signal.aborted) {
        void pending.catch(() => undefined)
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void pending.then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
  }

  private notify(method: string, params?: unknown): Promise<void> {
    this.notifications.push({ method, params })
    return Promise.resolve()
  }

  private defaultResponse(method: string): unknown {
    switch (method) {
      case 'session/new':
        this.sessionSequence += 1
        return { sessionId: `${this.name}-session-${this.sessionSequence}` }
      case 'session/list':
        return { sessions: [] }
      case 'session/load':
      case 'session/resume':
      case 'session/close':
      case 'session/set_mode':
      case 'session/set_config_option':
        return {}
      case 'session/prompt':
        return { stopReason: 'end_turn' }
      default:
        throw new Error(`Unexpected ACP request: ${method}`)
    }
  }
}

const services: AcpSessionService[] = []

function makeService(...clients: FakeClient[]) {
  const remaining = [...clients]
  const createClient = jest.fn((_options: AcpClientOptions): FakeClient => {
    const client = remaining.shift()
    if (!client) throw new Error('No fake ACP client available')
    return client
  })
  const service = new AcpSessionService(
    APP,
    () => SETTINGS,
    'test-version',
    undefined,
    createClient,
  )
  services.push(service)
  return { service, createClient }
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
})

describe('AcpSessionService', () => {
  it('deduplicates eager createTab session/new with the first submit', async () => {
    const sessionNew = deferred<NewSessionResponse>()
    const prompt = deferred<PromptResponse>()
    const client = new FakeClient('A')
    client.queueResponse('session/new', sessionNew.promise)
    client.queueResponse('session/prompt', prompt.promise)
    const { service } = makeService(client)

    const tabId = service.createTab()
    const submitting = service.submit(tabId, 'hello', PROMPT)
    await flushMicrotasks()
    const newCallsWhilePending = client.countRequests('session/new')

    sessionNew.resolve({ sessionId: 'session-1' })
    const result = await submitting
    const promptCalls = client.countRequests('session/prompt')
    prompt.resolve({ stopReason: 'end_turn' })
    await flushMicrotasks()

    expect(newCallsWhilePending).toBe(1)
    expect(result).toBe('accepted')
    expect(promptCalls).toBe(1)
  })

  it('returns busy and does not send another prompt while one is pending', async () => {
    const prompt = deferred<PromptResponse>()
    const client = new FakeClient('A')
    client.queueResponse('session/prompt', prompt.promise)
    const { service } = makeService(client)
    const tabId = service.createTab()
    await flushMicrotasks()

    const first = await service.submit(tabId, 'first', PROMPT)
    const second = await service.submit(tabId, 'second', PROMPT)
    const promptCalls = client.countRequests('session/prompt')
    prompt.resolve({ stopReason: 'end_turn' })
    await flushMicrotasks()

    expect(first).toBe('accepted')
    expect(second).toBe('busy')
    expect(promptCalls).toBe(1)
    expect(service.getState(tabId)?.status).toBe('idle')
  })

  it('does not apply the control-request timeout to a prompt turn', async () => {
    jest.useFakeTimers()
    try {
      const prompt = deferred<PromptResponse>()
      const client = new FakeClient('A')
      client.queueResponse('session/prompt', prompt.promise)
      const { service } = makeService(client)
      const tabId = service.createTab()
      await flushMicrotasks()

      expect(await service.submit(tabId, 'long task', PROMPT)).toBe('accepted')
      const promptRequest = client.requests.find(
        (request) => request.method === 'session/prompt',
      )
      expect(promptRequest?.options).toBeUndefined()

      jest.advanceTimersByTime(60_000)
      await flushMicrotasks()

      expect(client.isConnected).toBe(true)
      expect(service.getAvailability()).toBe('ready')
      expect(service.getState(tabId)?.status).toBe('running')

      prompt.resolve({ stopReason: 'end_turn' })
      await flushMicrotasks()
      expect(service.getState(tabId)?.status).toBe('idle')
    } finally {
      jest.useRealTimers()
    }
  })

  it('returns failed without a local user entry when connect fails', async () => {
    const connect = deferred<undefined>()
    const client = new FakeClient('A', connect)
    const { service } = makeService(client)
    const tabId = service.createTab()

    const submitting = service.submit(tabId, 'hello', PROMPT)
    connect.reject(new Error('connect failed'))
    const result = await submitting

    expect(result).toBe('failed')
    expect(service.getState(tabId)?.entries).toEqual([])
    expect(client.countRequests('session/prompt')).toBe(0)
  })

  it('cancels while session/new is pending without sending a prompt', async () => {
    const sessionNew = deferred<NewSessionResponse>()
    const client = new FakeClient('A')
    client.queueResponse('session/new', sessionNew.promise)
    const { service } = makeService(client)
    const tabId = service.createTab()
    const submitting = service.submit(tabId, 'hello', PROMPT)
    await flushMicrotasks()

    const newCallsWhilePending = client.countRequests('session/new')
    await service.cancel(tabId)
    const statusWhileCancelling = service.getState(tabId)?.status
    sessionNew.resolve({ sessionId: 'session-1' })
    const result = await submitting

    expect(newCallsWhilePending).toBe(1)
    expect(statusWhileCancelling).toBe('cancelling')
    expect(result).toBe('failed')
    expect(client.countRequests('session/prompt')).toBe(0)
    expect(service.getState(tabId)?.status).toBe('idle')
  })

  it('deduplicates concurrent history load and remote close', async () => {
    const load = deferred<LoadSessionResponse>()
    const close = deferred<Record<string, never>>()
    const client = new FakeClient('A')
    client.queueResponse('session/load', load.promise)
    client.queueResponse('session/close', close.promise)
    const { service } = makeService(client)

    const firstOpen = service.openHistoryTab('history-1', 'History')
    const secondOpen = service.openHistoryTab('history-1', 'History')
    await flushMicrotasks()
    const loadCallsWhilePending = client.countRequests('session/load')
    load.resolve({})
    const [firstTabId, secondTabId] = await Promise.all([firstOpen, secondOpen])

    const firstClose = service.closeTab(firstTabId)
    const secondClose = service.closeTab(secondTabId)
    await flushMicrotasks()
    const closeCallsWhilePending = client.countRequests('session/close')
    close.resolve({})
    await Promise.all([firstClose, secondClose])

    expect(loadCallsWhilePending).toBe(1)
    expect(firstTabId).toBe(secondTabId)
    expect(closeCallsWhilePending).toBe(1)
    expect(
      client.requests.find((request) => request.method === 'session/close')
        ?.params,
    ).toEqual({ sessionId: 'history-1' })
  })

  it('retries with a new client and resumes the old session before prompting', async () => {
    const resume = deferred<Record<string, never>>()
    const prompt = deferred<PromptResponse>()
    const firstClient = new FakeClient('A')
    const secondClient = new FakeClient('B')
    secondClient.queueResponse('session/resume', resume.promise)
    secondClient.queueResponse('session/prompt', prompt.promise)
    const { service, createClient } = makeService(firstClient, secondClient)
    const tabId = service.createTab()
    await flushMicrotasks()
    const sessionId = service.getState(tabId)?.sessionId

    firstClient.emitDisconnect({
      kind: 'connection-closed',
      error: new Error('connection lost'),
    })
    const submitting = service.submit(tabId, 'after retry', PROMPT)
    await flushMicrotasks()
    const methodsBeforeResume = secondClient.requests.map(
      (request) => request.method,
    )
    resume.resolve({})
    const result = await submitting
    const methodsAfterResume = secondClient.requests.map(
      (request) => request.method,
    )
    prompt.resolve({ stopReason: 'end_turn' })
    await flushMicrotasks()

    expect(sessionId).toBe('A-session-1')
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(methodsBeforeResume).toEqual(['session/resume'])
    expect(methodsAfterResume).toEqual(['session/resume', 'session/prompt'])
    expect(secondClient.requests[0]?.params).toEqual({
      sessionId,
      cwd: '/vault',
      mcpServers: [],
    })
    expect(result).toBe('accepted')
  })

  it('ignores a late disconnect from an old client after retry is ready', async () => {
    const firstClient = new FakeClient('A')
    const secondClient = new FakeClient('B')
    const { service } = makeService(firstClient, secondClient)
    await service.ensureStarted()

    firstClient.emitDisconnect({
      kind: 'connection-closed',
      error: new Error('first disconnect'),
    })
    await service.ensureStarted()
    const secondDisposeCalls = secondClient.dispose.mock.calls.length
    firstClient.emitDisconnect({
      kind: 'process-exit',
      code: 1,
      signal: null,
    })

    expect(service.getAvailability()).toBe('ready')
    expect(service.getAgentInfo()?.name).toBe('B')
    expect(secondClient.isConnected).toBe(true)
    expect(secondClient.dispose).toHaveBeenCalledTimes(secondDisposeCalls)
  })

  it('waits for the previous client teardown before reconnecting', async () => {
    const disposeGate = deferred<undefined>()
    const firstClient = new FakeClient(
      'A',
      null,
      OPENCODE_CAPABILITIES,
      disposeGate,
    )
    const secondClient = new FakeClient('B')
    const { service, createClient } = makeService(firstClient, secondClient)
    await service.ensureStarted()
    const reconnects: Promise<void>[] = []
    service.onAvailabilityChange((state) => {
      if (state === 'unavailable') reconnects.push(service.ensureStarted())
    })

    firstClient.emitDisconnect({
      kind: 'connection-closed',
      error: new Error('connection lost'),
    })
    await flushMicrotasks()

    expect(reconnects).toHaveLength(1)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(secondClient.connect).not.toHaveBeenCalled()

    disposeGate.resolve(undefined)
    await Promise.all(reconnects)

    expect(createClient).toHaveBeenCalledTimes(2)
    expect(secondClient.connect).toHaveBeenCalledTimes(1)
    expect(service.getAgentInfo()?.name).toBe('B')
  })

  it('does not attach a late history load response to a new connection', async () => {
    const load = deferred<LoadSessionResponse>()
    const firstClient = new FakeClient('A')
    const secondClient = new FakeClient('B')
    firstClient.queueResponse('session/load', load.promise)
    const { service } = makeService(firstClient, secondClient)

    const opening = service.openHistoryTab('history-1', 'History')
    await flushMicrotasks()
    expect(firstClient.countRequests('session/load')).toBe(1)

    firstClient.emitDisconnect({
      kind: 'connection-closed',
      error: new Error('connection lost'),
    })
    await service.ensureStarted()
    load.resolve({})
    const tabId = await opening

    const result = await service.submit(tabId, 'retry', PROMPT)
    await flushMicrotasks()

    expect(result).toBe('accepted')
    expect(secondClient.requests.map((request) => request.method)).toEqual([
      'session/resume',
      'session/prompt',
    ])
  })

  it('does not let a stale history failure overwrite a replacement turn', async () => {
    const load = deferred<LoadSessionResponse>()
    const prompt = deferred<PromptResponse>()
    const firstClient = new FakeClient('A')
    const secondClient = new FakeClient('B')
    firstClient.queueResponse('session/load', load.promise)
    secondClient.queueResponse('session/prompt', prompt.promise)
    const { service } = makeService(firstClient, secondClient)

    const opening = service.openHistoryTab('history-1', 'History')
    await flushMicrotasks()
    const tabId = service.listTabs()[0]?.tabId
    expect(tabId).toBeDefined()

    firstClient.emitDisconnect({
      kind: 'connection-closed',
      error: new Error('connection lost'),
    })
    const result = await service.submit(tabId, 'retry', PROMPT)
    expect(result).toBe('accepted')
    expect(service.getState(tabId)?.status).toBe('running')

    load.resolve({})
    await opening
    expect(service.getState(tabId)?.status).toBe('running')

    prompt.resolve({ stopReason: 'end_turn' })
    await flushMicrotasks()
  })

  it('starts replacement session setup instead of awaiting the old generation', async () => {
    const oldSession = deferred<NewSessionResponse>()
    const firstClient = new FakeClient('A')
    const secondClient = new FakeClient('B')
    firstClient.queueResponse('session/new', oldSession.promise)
    const { service } = makeService(firstClient, secondClient)
    const tabId = service.createTab()
    await flushMicrotasks()
    expect(firstClient.countRequests('session/new')).toBe(1)

    firstClient.emitDisconnect({
      kind: 'connection-closed',
      error: new Error('connection lost'),
    })
    const result = await service.submit(tabId, 'retry', PROMPT)

    expect(result).toBe('accepted')
    expect(secondClient.requests.map((request) => request.method)).toEqual([
      'session/new',
      'session/prompt',
    ])

    oldSession.resolve({ sessionId: 'stale-session' })
    await flushMicrotasks()
  })

  it('waits for default mode setup before sending the first prompt', async () => {
    const setMode = deferred<Record<string, never>>()
    const prompt = deferred<PromptResponse>()
    const client = new FakeClient('A')
    client.queueResponse('session/new', {
      sessionId: 'session-1',
      modes: {
        currentModeId: 'plan',
        availableModes: [
          { id: 'plan', name: 'Plan' },
          { id: 'build', name: 'Build' },
        ],
      },
    })
    client.queueResponse('session/set_mode', setMode.promise)
    client.queueResponse('session/prompt', prompt.promise)
    const { service } = makeService(client)
    const tabId = service.createTab()
    await flushMicrotasks()

    const submitting = service.submit(tabId, 'hello', PROMPT)
    await flushMicrotasks()
    expect(client.countRequests('session/set_mode')).toBe(1)
    expect(client.countRequests('session/prompt')).toBe(0)

    setMode.resolve({})
    await expect(submitting).resolves.toBe('accepted')
    expect(client.countRequests('session/prompt')).toBe(1)

    prompt.resolve({ stopReason: 'end_turn' })
    await flushMicrotasks()
  })

  it('does not resume an attached session after default mode setup fails', async () => {
    const client = new FakeClient('A')
    client.queueResponse('session/new', {
      sessionId: 'session-1',
      modes: {
        currentModeId: 'plan',
        availableModes: [
          { id: 'plan', name: 'Plan' },
          { id: 'build', name: 'Build' },
        ],
      },
    })
    client.queueResponse('session/set_mode', new Error('mode rejected'))
    const { service } = makeService(client)
    const tabId = service.createTab()
    await flushMicrotasks()

    const result = await service.submit(tabId, 'hello', PROMPT)

    expect(result).toBe('accepted')
    expect(client.countRequests('session/resume')).toBe(0)
    expect(client.countRequests('session/load')).toBe(0)
    expect(client.requests.map((request) => request.method)).toEqual([
      'session/new',
      'session/set_mode',
      'session/prompt',
    ])
  })

  it('aborts and joins a history load before reopening the session', async () => {
    const load = deferred<LoadSessionResponse>()
    const client = new FakeClient('A')
    client.queueResponse('session/load', load.promise)
    const { service } = makeService(client)
    const opening = service.openHistoryTab('history-1', 'History')
    const openingResult = opening.catch((error: unknown) => error)
    await flushMicrotasks()
    const tabId = service.listTabs()[0]?.tabId
    expect(tabId).toBeDefined()

    await service.closeTab(tabId)
    const loadError = await openingResult

    expect(loadError).toBeInstanceOf(Error)
    expect(client.requests[0]?.options?.cancellationSignal?.aborted).toBe(true)
    expect(client.countRequests('session/close')).toBe(1)

    const reopenedTabId = await service.openHistoryTab('history-1', 'History')
    expect(reopenedTabId).not.toBe(tabId)
    expect(client.countRequests('session/load')).toBe(2)
  })

  it('recycles the originating connection when a history load ignores cancellation', async () => {
    jest.useFakeTimers()
    try {
      const load = deferred<LoadSessionResponse>()
      const firstClient = new FakeClient(
        'A',
        null,
        OPENCODE_CAPABILITIES,
        null,
        false,
      )
      const secondClient = new FakeClient('B')
      firstClient.queueResponse('session/load', load.promise)
      const { service, createClient } = makeService(firstClient, secondClient)
      const opening = service.openHistoryTab('history-1', 'History')
      const openingResult = opening.catch((error: unknown) => error)
      await flushMicrotasks()
      const tabId = service.listTabs()[0]?.tabId
      expect(tabId).toBeDefined()

      let closed = false
      const closing = service.closeTab(tabId).then(() => {
        closed = true
      })
      await flushMicrotasks()
      expect(closed).toBe(false)

      jest.advanceTimersByTime(15_000)
      await closing

      expect(firstClient.dispose).toHaveBeenCalled()
      expect(service.getAvailability()).toBe('unavailable')

      load.resolve({})
      expect(await openingResult).toBeInstanceOf(Error)
      const reopenedTabId = await service.openHistoryTab('history-1', 'History')

      expect(reopenedTabId).not.toBe(tabId)
      expect(createClient).toHaveBeenCalledTimes(2)
      expect(secondClient.countRequests('session/load')).toBe(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('waits for a closing turn before reopening the same session', async () => {
    const prompt = deferred<PromptResponse>()
    const client = new FakeClient('A', null, {
      ...OPENCODE_CAPABILITIES,
      sessionCapabilities: { list: {}, resume: {} },
    })
    client.queueResponse('session/prompt', prompt.promise)
    const { service } = makeService(client)
    const tabId = service.createTab()
    await flushMicrotasks()
    expect(await service.submit(tabId, 'hello', PROMPT)).toBe('accepted')
    const sessionId = service.getState(tabId)?.sessionId as string

    const closing = service.closeTab(tabId)
    const reopening = service.openHistoryTab(sessionId, 'History')
    await flushMicrotasks()

    expect(service.getState(tabId)).toBeNull()
    expect(client.countRequests('session/load')).toBe(0)

    prompt.reject({ code: -32800, message: 'cancelled' })
    await closing
    const reopenedTabId = await reopening

    expect(client.countRequests('session/load')).toBe(1)
    expect(reopenedTabId).not.toBe(tabId)
  })

  it('cancels a running turn without sending unsupported session/close', async () => {
    const prompt = deferred<PromptResponse>()
    const client = new FakeClient('A', null, {
      ...OPENCODE_CAPABILITIES,
      sessionCapabilities: { list: {}, resume: {} },
    })
    client.queueResponse('session/prompt', prompt.promise)
    const { service } = makeService(client)
    const tabId = service.createTab()
    await flushMicrotasks()
    expect(await service.submit(tabId, 'hello', PROMPT)).toBe('accepted')

    const closing = service.closeTab(tabId)
    prompt.reject({ code: -32800, message: 'cancelled' })
    await closing
    await flushMicrotasks()

    expect(client.notifications).toContainEqual({
      method: 'session/cancel',
      params: { sessionId: 'A-session-1' },
    })
    expect(client.countRequests('session/close')).toBe(0)
    expect(service.getState(tabId)).toBeNull()
  })

  it('does not let a closed turn cancel a replacement connection', async () => {
    jest.useFakeTimers()
    try {
      const sessionNew = deferred<NewSessionResponse>()
      const firstClient = new FakeClient('A')
      const secondClient = new FakeClient('B')
      firstClient.queueResponse('session/new', sessionNew.promise)
      const { service } = makeService(firstClient, secondClient)
      const tabId = service.createTab()
      const submitting = service.submit(tabId, 'hello', PROMPT)
      await flushMicrotasks()

      await service.closeTab(tabId)
      firstClient.emitDisconnect({
        kind: 'connection-closed',
        error: new Error('connection lost'),
      })
      await service.ensureStarted()

      jest.advanceTimersByTime(15_000)
      await flushMicrotasks()

      expect(service.getAvailability()).toBe('ready')
      expect(secondClient.isConnected).toBe(true)
      expect(secondClient.dispose).not.toHaveBeenCalled()

      sessionNew.resolve({ sessionId: 'old-session' })
      await expect(submitting).resolves.toBe('failed')
    } finally {
      jest.useRealTimers()
    }
  })

  it('reconnects an unbound submit after an older closed turn times out', async () => {
    jest.useFakeTimers()
    try {
      const oldPrompt = deferred<PromptResponse>()
      const firstClient = new FakeClient('A')
      const secondClient = new FakeClient('B')
      firstClient.queueResponse('session/prompt', oldPrompt.promise)
      const { service, createClient } = makeService(firstClient, secondClient)
      const oldTabId = service.createTab()
      await flushMicrotasks()
      expect(await service.submit(oldTabId, 'old', PROMPT)).toBe('accepted')

      const closing = service.closeTab(oldTabId)
      const nextTabId = service.createTab()
      const nextSubmit = service.submit(nextTabId, 'next', PROMPT)
      await flushMicrotasks()
      expect(firstClient.countRequests('session/prompt')).toBe(1)

      jest.advanceTimersByTime(15_000)
      await flushMicrotasks()

      await expect(nextSubmit).resolves.toBe('accepted')
      await closing
      expect(createClient).toHaveBeenCalledTimes(2)
      expect(secondClient.requests.map((request) => request.method)).toEqual([
        'session/resume',
        'session/prompt',
      ])

      oldPrompt.resolve({ stopReason: 'cancelled' })
      await flushMicrotasks()
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not become ready after disposal while connect is pending', async () => {
    const connect = deferred<undefined>()
    const client = new FakeClient('A', connect)
    const { service } = makeService(client)
    const availability: string[] = []
    service.onAvailabilityChange((state) => availability.push(state))

    const starting = service.ensureStarted()
    await flushMicrotasks()
    await service.dispose()
    connect.resolve(undefined)
    const startError = await starting.catch((error: unknown) => error)

    expect(startError).toBeInstanceOf(Error)
    expect((startError as Error).message).toBe(
      'ACP session service was disposed while starting',
    )
    expect(service.getAvailability()).toBe('unknown')
    expect(availability).toEqual(['starting'])
    expect(client.isConnected).toBe(false)
    expect(client.dispose).toHaveBeenCalled()
  })
})
