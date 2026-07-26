import * as acp from '@agentclientprotocol/sdk'
import type {
  ClientConnection,
  Implementation,
  RequestPermissionRequest,
  SessionNotification,
} from '@agentclientprotocol/sdk'

import type { FsBridge } from './fsBridge'
import type { PermissionManager } from './permissions'
import { resolveOpencodeBinary, spawnOpencodeAcp } from './process'
import type { SpawnedProcess } from './process'
import { nodeReadableToWeb, nodeWritableToWeb } from './streams'

export type AcpClientHooks = {
  fsBridge: FsBridge
  permissionManager: PermissionManager
  onSessionUpdate: (notification: SessionNotification) => void
  onPermissionPending: (params: RequestPermissionRequest) => void
  onPermissionSettled: (toolCallId: string) => void
  onStderr?: (line: string) => void
  onDebug?: (event: string, payload: unknown) => void
  onProcessExit?: (code: number | null, signal: string | null) => void
}

export class OpencodeNotFoundError extends Error {
  constructor() {
    super('opencode binary not found')
    this.name = 'OpencodeNotFoundError'
  }
}

export class AcpClient {
  private connection: ClientConnection | null = null
  private child: SpawnedProcess | null = null
  private agentInfoValue: Implementation | null = null

  constructor(
    private readonly options: {
      configuredPath: string
      extraArgs: string[]
      cwd: string
      clientName: string
      clientVersion: string
    },
  ) {}

  get agentInfo(): Implementation | null {
    return this.agentInfoValue
  }

  get isConnected(): boolean {
    return this.connection !== null
  }

  async connect(hooks: AcpClientHooks): Promise<void> {
    if (this.connection) return
    const binary = await resolveOpencodeBinary(this.options.configuredPath)
    if (!binary) {
      throw new OpencodeNotFoundError()
    }
    const child = await spawnOpencodeAcp({
      binary,
      args: this.options.extraArgs,
      cwd: this.options.cwd,
    })
    this.child = child
    child.onExit((code, signal) => {
      this.connection = null
      this.child = null
      hooks.onProcessExit?.(code, signal)
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
      .onRequest('session/request_permission', ({ params }) => {
        return hooks.permissionManager.handleRequest(params, {
          onPending: hooks.onPermissionPending,
          onSettled: hooks.onPermissionSettled,
        })
      })
      .onRequest('fs/read_text_file', ({ params }) => {
        hooks.onDebug?.('fs/read_text_file', params)
        return hooks.fsBridge.readTextFile(params)
      })
      .onRequest('fs/write_text_file', ({ params }) => {
        hooks.onDebug?.('fs/write_text_file', params)
        return hooks.fsBridge.writeTextFile(params)
      })
    const connection = app.connect(stream)
    const initResponse = await connection.agent.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
      clientInfo: {
        name: this.options.clientName,
        version: this.options.clientVersion,
      },
    })
    this.agentInfoValue = initResponse.agentInfo ?? null
    hooks.onDebug?.('initialize', initResponse)
    this.connection = connection
  }

  agent(): acp.ClientContext {
    if (!this.connection) {
      throw new Error('ACP client is not connected')
    }
    return this.connection.agent
  }

  async dispose(): Promise<void> {
    const child = this.child
    this.connection = null
    this.child = null
    child?.kill()
  }
}
