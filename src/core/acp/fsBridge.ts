import * as path from 'node:path'

import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk'
import type { App } from 'obsidian'
import { normalizePath } from 'obsidian'

export class FsBridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FsBridgeError'
  }
}

function toForwardSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

export class FsBridge {
  constructor(private readonly app: App) {}

  private vaultBasePath(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string }
    if (typeof adapter.getBasePath !== 'function') {
      throw new FsBridgeError('Vault base path is not available')
    }
    return adapter.getBasePath()
  }

  toVaultRelativePath(absolutePath: string): string {
    const platformPath = process.platform === 'win32' ? path.win32 : path.posix
    const basePath = this.vaultBasePath()
    if (!platformPath.isAbsolute(basePath)) {
      throw new FsBridgeError(`Vault base path is not absolute: ${basePath}`)
    }
    if (!platformPath.isAbsolute(absolutePath)) {
      throw new FsBridgeError(`Path is not absolute: ${absolutePath}`)
    }

    const base = platformPath.resolve(basePath)
    const target = platformPath.resolve(absolutePath)
    const relative = platformPath.relative(base, target)
    if (relative === '') {
      throw new FsBridgeError(`Path is the vault root: ${absolutePath}`)
    }
    if (
      platformPath.isAbsolute(relative) ||
      relative === '..' ||
      relative.startsWith(`..${platformPath.sep}`)
    ) {
      throw new FsBridgeError(`Path is outside the vault: ${absolutePath}`)
    }
    return normalizePath(toForwardSlashes(relative))
  }

  async readTextFile(
    params: ReadTextFileRequest,
  ): Promise<ReadTextFileResponse> {
    const relative = this.toVaultRelativePath(params.path)
    const adapter = this.app.vault.adapter
    if (!(await adapter.exists(relative))) {
      throw new FsBridgeError(`File not found: ${params.path}`)
    }
    let content = await adapter.read(relative)
    if (params.line != null || params.limit != null) {
      const lines = content.split('\n')
      const start = Math.max((params.line ?? 1) - 1, 0)
      const end =
        params.limit != null ? start + Math.max(params.limit, 0) : undefined
      content = lines.slice(start, end).join('\n')
    }
    return { content }
  }

  async writeTextFile(
    params: WriteTextFileRequest,
  ): Promise<WriteTextFileResponse> {
    const relative = this.toVaultRelativePath(params.path)
    await this.ensureParentFolder(relative)
    await this.app.vault.adapter.write(relative, params.content)
    return {}
  }

  private async ensureParentFolder(relativePath: string) {
    const segments = relativePath.split('/')
    segments.pop()
    if (segments.length === 0) return
    let current = ''
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current)
      }
    }
  }
}
