import { PassThrough } from 'node:stream'

import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

import { AcpClient } from './client'
import type {
  AcpClientHooks,
  AcpClientOptions,
  AcpDisconnectReason,
} from './client'
import { resolveOpencodeBinary, spawnOpencodeAcp } from './process'
import type { SpawnedProcess } from './process'

jest.mock('./process', () => ({
  resolveOpencodeBinary: jest.fn(),
  spawnOpencodeAcp: jest.fn(),
}))

const mockResolveOpencodeBinary = jest.mocked(resolveOpencodeBinary)
const mockSpawnOpencodeAcp = jest.mocked(spawnOpencodeAcp)

const options: AcpClientOptions = {
  configuredPath: '/configured/opencode',
  extraArgs: ['--test'],
  cwd: '/vault',
  clientName: 'test-client',
  clientVersion: '1.2.3',
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

type FakeProcess = {
  child: SpawnedProcess
  closeStdin: jest.MockedFunction<() => void>
  exit: (code: number | null, signal: string | null) => void
  kill: jest.MockedFunction<(signal?: NodeJS.Signals) => void>
  stderr: PassThrough
  stdin: PassThrough
  stdout: PassThrough
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function makeProcess(
  autoExit: { stdin?: boolean; sigterm?: boolean; sigkill?: boolean } = {},
): FakeProcess {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const processExit = deferred<{
    code: number | null
    signal: string | null
  }>()
  let exited = false

  const exit = (code: number | null, signal: string | null) => {
    if (exited) return
    exited = true
    if (!stdin.writableEnded && !stdin.destroyed) stdin.end()
    processExit.resolve({ code, signal })
  }
  const closeStdin = jest.fn((): void => {
    if (autoExit.stdin !== false) exit(0, null)
  })
  const kill = jest.fn((signal: NodeJS.Signals = 'SIGTERM'): void => {
    if (signal === 'SIGKILL') {
      if (autoExit.sigkill !== false) exit(null, signal)
    } else if (autoExit.sigterm !== false) {
      exit(null, signal)
    }
  })
  const child: SpawnedProcess = {
    pid: 1234,
    stdin,
    stdout,
    stderr,
    exited: processExit.promise,
    onExit: (callback) => {
      void processExit.promise.then(({ code, signal }) =>
        callback(code, signal),
      )
    },
    closeStdin,
    kill,
  }

  return { child, closeStdin, exit, kill, stderr, stdin, stdout }
}

function observeInitialize(
  fakeProcess: FakeProcess,
  handler: (request: JsonRpcRequest) => void,
): Promise<JsonRpcRequest> {
  const received = deferred<JsonRpcRequest>()
  let buffer = ''
  let handled = false

  fakeProcess.stdin.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString()
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) {
        const message = JSON.parse(line) as Record<string, unknown>
        if (!handled && message.method === 'initialize' && 'id' in message) {
          handled = true
          const request = message as JsonRpcRequest
          received.resolve(request)
          handler(request)
        }
      }
      newline = buffer.indexOf('\n')
    }
  })

  return received.promise
}

function sendResult(
  fakeProcess: FakeProcess,
  request: JsonRpcRequest,
  result: Record<string, unknown>,
): void {
  fakeProcess.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`,
  )
}

function sendError(
  fakeProcess: FakeProcess,
  request: JsonRpcRequest,
  message: string,
): void {
  fakeProcess.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32000, message },
    })}\n`,
  )
}

function makeHooks(
  onDisconnected?: (reason: AcpDisconnectReason) => void,
): AcpClientHooks {
  return {
    fsBridge: {} as unknown as AcpClientHooks['fsBridge'],
    permissionManager: {} as unknown as AcpClientHooks['permissionManager'],
    onSessionUpdate: jest.fn(),
    onPermissionPending: jest.fn(),
    onPermissionSettled: jest.fn(),
    onDisconnected,
  }
}

function expectCleanedUp(client: AcpClient): void {
  const state = client as unknown as {
    child: SpawnedProcess | null
    connection: unknown
  }
  expect(client.isConnected).toBe(false)
  expect(state.connection).toBeNull()
  expect(state.child).toBeNull()
  expect(() => client.agent()).toThrow('ACP client is not connected')
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('AcpClient lifecycle', () => {
  let clients: AcpClient[]

  beforeEach(() => {
    jest.resetAllMocks()
    clients = []
    mockResolveOpencodeBinary.mockResolvedValue('/mock/opencode')
  })

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.dispose()))
  })

  function makeClient(fakeProcess: FakeProcess): AcpClient {
    mockSpawnOpencodeAcp.mockResolvedValue(fakeProcess.child)
    const client = new AcpClient(options)
    clients.push(client)
    return client
  }

  it('stores agent metadata and reports connected after initialization', async () => {
    const fakeProcess = makeProcess()
    const client = makeClient(fakeProcess)
    const agentInfo = { name: 'test-agent', version: '9.8.7' }
    const agentCapabilities = {
      loadSession: true,
      promptCapabilities: {
        audio: false,
        embeddedContext: false,
        image: true,
      },
    }
    const initializeRequest = observeInitialize(fakeProcess, (request) => {
      sendResult(fakeProcess, request, {
        protocolVersion: PROTOCOL_VERSION,
        agentInfo,
        agentCapabilities,
      })
    })

    await client.connect(makeHooks())

    await expect(initializeRequest).resolves.toMatchObject({
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'test-client', version: '1.2.3' },
      },
    })
    expect(client.agentInfo).toMatchObject(agentInfo)
    expect(client.agentCapabilities).toMatchObject(agentCapabilities)
    expect(client.isConnected).toBe(true)

    await client.dispose()
  })

  it('cleans up the connection and process when initialize returns an error', async () => {
    const fakeProcess = makeProcess()
    const client = makeClient(fakeProcess)
    observeInitialize(fakeProcess, (request) => {
      sendError(fakeProcess, request, 'initialize failed')
    })

    await expect(client.connect(makeHooks())).rejects.toThrow(
      'initialize failed',
    )

    expectCleanedUp(client)
    expect(fakeProcess.closeStdin).toHaveBeenCalledTimes(1)
    expect(fakeProcess.stdin.writableEnded).toBe(true)
    expect(fakeProcess.kill).not.toHaveBeenCalled()
    await expect(client.connect(makeHooks())).rejects.toThrow(
      'ACP client has been disposed',
    )
    expect(mockSpawnOpencodeAcp).toHaveBeenCalledTimes(1)
  })

  it('settles a pending connect when disposed and cleans up idempotently', async () => {
    const fakeProcess = makeProcess()
    const client = makeClient(fakeProcess)
    const initializeRequest = observeInitialize(fakeProcess, () => undefined)
    const connectOutcome = client.connect(makeHooks()).then(
      () => ({ status: 'resolved' as const, error: null }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )
    await initializeRequest

    await Promise.all([client.dispose(), client.dispose()])
    const outcome = await connectOutcome
    await client.dispose()

    expect(outcome.status).toBe('rejected')
    expect(outcome.error).toEqual(
      expect.objectContaining({ message: 'ACP client disposed' }),
    )
    expectCleanedUp(client)
    expect(fakeProcess.closeStdin).toHaveBeenCalledTimes(1)
    expect(fakeProcess.stdin.writableEnded).toBe(true)
    expect(fakeProcess.kill).not.toHaveBeenCalled()
    await expect(fakeProcess.child.exited).resolves.toEqual({
      code: 0,
      signal: null,
    })
  })

  it('cancels an in-flight binary lookup without blocking dispose', async () => {
    const binary = deferred<string | null>()
    mockResolveOpencodeBinary.mockReturnValue(binary.promise)
    const client = new AcpClient(options)
    clients.push(client)
    const connecting = client.connect(makeHooks())
    const rejectedConnect = expect(connecting).rejects.toThrow(
      'ACP client disposed',
    )
    await flushMicrotasks()

    let disposed = false
    const disposing = client.dispose().then(() => {
      disposed = true
    })
    await disposing

    expect(disposed).toBe(true)
    expect(mockSpawnOpencodeAcp).not.toHaveBeenCalled()
    await rejectedConnect

    binary.resolve('/mock/opencode')
    await disposing

    expect(disposed).toBe(true)
    expect(mockSpawnOpencodeAcp).not.toHaveBeenCalled()
  })

  it('cleans up a child returned after dispose without blocking dispose', async () => {
    const spawned = deferred<SpawnedProcess>()
    const fakeProcess = makeProcess()
    mockSpawnOpencodeAcp.mockReturnValue(spawned.promise)
    const client = new AcpClient(options)
    clients.push(client)
    const connecting = client.connect(makeHooks())
    const rejectedConnect = expect(connecting).rejects.toThrow(
      'ACP client disposed',
    )
    await flushMicrotasks()
    expect(mockSpawnOpencodeAcp).toHaveBeenCalledTimes(1)

    let disposed = false
    const disposing = client.dispose().then(() => {
      disposed = true
    })
    await disposing
    expect(disposed).toBe(true)
    await rejectedConnect

    spawned.resolve(fakeProcess.child)
    await flushMicrotasks()
    expect(disposed).toBe(true)
    expect(fakeProcess.closeStdin).toHaveBeenCalledTimes(1)
    expect(fakeProcess.kill).not.toHaveBeenCalled()
  })

  it('bounds process shutdown after escalating through SIGKILL', async () => {
    const fakeProcess = makeProcess({
      stdin: false,
      sigterm: false,
      sigkill: false,
    })
    const client = makeClient(fakeProcess)
    observeInitialize(fakeProcess, (request) => {
      sendResult(fakeProcess, request, { protocolVersion: PROTOCOL_VERSION })
    })
    await client.connect(makeHooks())

    jest.useFakeTimers()
    try {
      let disposed = false
      const disposing = client.dispose().then(() => {
        disposed = true
      })
      await flushMicrotasks()
      expect(fakeProcess.closeStdin).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(2_000)
      await flushMicrotasks()
      expect(fakeProcess.kill).toHaveBeenCalledWith('SIGTERM')

      jest.advanceTimersByTime(1_000)
      await flushMicrotasks()
      expect(fakeProcess.kill).toHaveBeenCalledWith('SIGKILL')
      expect(disposed).toBe(false)

      jest.advanceTimersByTime(1_000)
      await disposing
      expect(disposed).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('times out a binary lookup that never settles', async () => {
    jest.useFakeTimers()
    try {
      const binary = deferred<string | null>()
      mockResolveOpencodeBinary.mockReturnValue(binary.promise)
      const client = new AcpClient(options)
      clients.push(client)
      const connecting = client.connect(makeHooks())
      const rejectedConnect = expect(connecting).rejects.toThrow(
        'ACP startup timed out',
      )
      await flushMicrotasks()

      jest.advanceTimersByTime(30_000)
      await rejectedConnect

      expect(mockSpawnOpencodeAcp).not.toHaveBeenCalled()
      expectCleanedUp(client)
    } finally {
      jest.useRealTimers()
    }
  })

  it('uses the single startup deadline while initialize is pending', async () => {
    jest.useFakeTimers()
    try {
      const fakeProcess = makeProcess()
      const client = makeClient(fakeProcess)
      const initializeRequest = observeInitialize(fakeProcess, () => undefined)
      const connecting = client.connect(makeHooks())
      const rejectedConnect = expect(connecting).rejects.toThrow(
        'ACP startup timed out',
      )
      await initializeRequest

      jest.advanceTimersByTime(30_000)
      await rejectedConnect

      expectCleanedUp(client)
      expect(fakeProcess.closeStdin).toHaveBeenCalledTimes(1)
      expect(fakeProcess.kill).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('reports a connected process exit only once', async () => {
    const fakeProcess = makeProcess()
    const client = makeClient(fakeProcess)
    const disconnected = deferred<AcpDisconnectReason>()
    const onDisconnected = jest.fn((reason: AcpDisconnectReason) => {
      disconnected.resolve(reason)
    })
    observeInitialize(fakeProcess, (request) => {
      sendResult(fakeProcess, request, { protocolVersion: PROTOCOL_VERSION })
    })
    await client.connect(makeHooks(onDisconnected))

    fakeProcess.exit(23, 'SIGTERM')
    await disconnected.promise
    await flushMicrotasks()

    expect(onDisconnected).toHaveBeenCalledTimes(1)
    expect(onDisconnected).toHaveBeenCalledWith({
      kind: 'process-exit',
      code: 23,
      signal: 'SIGTERM',
    })
    expectCleanedUp(client)
  })

  it('reports a connected stream close only once while stopping the process', async () => {
    const fakeProcess = makeProcess()
    const client = makeClient(fakeProcess)
    const disconnected = deferred<AcpDisconnectReason>()
    const onDisconnected = jest.fn((reason: AcpDisconnectReason) => {
      disconnected.resolve(reason)
    })
    observeInitialize(fakeProcess, (request) => {
      sendResult(fakeProcess, request, { protocolVersion: PROTOCOL_VERSION })
    })
    await client.connect(makeHooks(onDisconnected))

    fakeProcess.stdout.end()
    const reason = await disconnected.promise
    await fakeProcess.child.exited
    await flushMicrotasks()

    expect(reason).toMatchObject({ kind: 'connection-closed' })
    expect(onDisconnected).toHaveBeenCalledTimes(1)
    expect(fakeProcess.closeStdin).toHaveBeenCalledTimes(1)
    expect(fakeProcess.kill).not.toHaveBeenCalled()
    expectCleanedUp(client)
  })

  it('does not report a disconnect when dispose closes an active client', async () => {
    const fakeProcess = makeProcess()
    const client = makeClient(fakeProcess)
    const onDisconnected = jest.fn(
      (_reason: AcpDisconnectReason): void => undefined,
    )
    observeInitialize(fakeProcess, (request) => {
      sendResult(fakeProcess, request, { protocolVersion: PROTOCOL_VERSION })
    })
    await client.connect(makeHooks(onDisconnected))

    await client.dispose()
    await fakeProcess.child.exited
    await flushMicrotasks()

    expect(onDisconnected).not.toHaveBeenCalled()
    expect(fakeProcess.closeStdin).toHaveBeenCalledTimes(1)
    expect(fakeProcess.kill).not.toHaveBeenCalled()
    expectCleanedUp(client)
  })

  it('rejects a mismatched protocol version and cleans up', async () => {
    const fakeProcess = makeProcess()
    const client = makeClient(fakeProcess)
    const onDisconnected = jest.fn(
      (_reason: AcpDisconnectReason): void => undefined,
    )
    observeInitialize(fakeProcess, (request) => {
      sendResult(fakeProcess, request, {
        protocolVersion: PROTOCOL_VERSION + 1,
      })
    })

    await expect(client.connect(makeHooks(onDisconnected))).rejects.toThrow(
      `Unsupported ACP protocol version: ${PROTOCOL_VERSION + 1}`,
    )

    expectCleanedUp(client)
    expect(client.agentInfo).toBeNull()
    expect(client.agentCapabilities).toEqual({})
    expect(onDisconnected).not.toHaveBeenCalled()
    expect(fakeProcess.closeStdin).toHaveBeenCalledTimes(1)
    expect(fakeProcess.stdin.writableEnded).toBe(true)
    expect(fakeProcess.kill).not.toHaveBeenCalled()
  })
})
