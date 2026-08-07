import { lstat, realpath } from 'node:fs/promises'
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

export type FsBridgeFileSystem = {
  lstat: (filePath: string) => Promise<{ isDirectory: () => boolean }>
  realpath: (filePath: string) => Promise<string>
}

const nodeFileSystem: FsBridgeFileSystem = { lstat, realpath }

function toForwardSlashes(value: string): string {
  return value.replace(/\\/g, '/')
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

export class FsBridge {
  constructor(
    private readonly app: App,
    private readonly fileSystem: FsBridgeFileSystem = nodeFileSystem,
  ) {}

  private platformPath(): path.PlatformPath {
    return process.platform === 'win32' ? path.win32 : path.posix
  }

  private vaultBasePath(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string }
    if (typeof adapter.getBasePath !== 'function') {
      throw new FsBridgeError('Vault base path is not available')
    }
    return adapter.getBasePath()
  }

  private resolvedLexicalPaths(absolutePath: string): {
    base: string
    relative: string
    target: string
  } {
    const platformPath = this.platformPath()
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
    if (this.isOutside(relative)) {
      throw new FsBridgeError(`Path is outside the vault: ${absolutePath}`)
    }
    return { base, relative, target }
  }

  private isOutside(relative: string): boolean {
    const platformPath = this.platformPath()
    return (
      platformPath.isAbsolute(relative) ||
      relative === '..' ||
      relative.startsWith(`..${platformPath.sep}`)
    )
  }

  toVaultRelativePath(absolutePath: string): string {
    const { relative } = this.resolvedLexicalPaths(absolutePath)
    return normalizePath(toForwardSlashes(relative))
  }

  private async resolveRealPathIfPresent(
    candidate: string,
  ): Promise<string | null> {
    try {
      await this.fileSystem.lstat(candidate)
    } catch (error) {
      if (isMissingPathError(error)) return null
      throw new FsBridgeError(
        `Unable to inspect path ${candidate}: ${this.errorMessage(error)}`,
      )
    }

    try {
      return await this.fileSystem.realpath(candidate)
    } catch (error) {
      throw new FsBridgeError(
        `Unable to resolve path ${candidate}: ${this.errorMessage(error)}`,
      )
    }
  }

  private async realVaultBase(base: string): Promise<string> {
    const resolved = await this.resolveRealPathIfPresent(base)
    if (!resolved) {
      throw new FsBridgeError(`Vault base path does not exist: ${base}`)
    }
    return this.platformPath().resolve(resolved)
  }

  private assertResolvedInside(
    realBase: string,
    resolvedTarget: string,
    requestedPath: string,
  ): void {
    const platformPath = this.platformPath()
    const target = platformPath.resolve(resolvedTarget)
    const relative = platformPath.relative(realBase, target)
    if (relative !== '' && !this.isOutside(relative)) return
    if (relative === '') return
    throw new FsBridgeError(
      `Path resolves outside the vault: ${requestedPath} -> ${target}`,
    )
  }

  private async assertExistingPathInside(absolutePath: string): Promise<void> {
    const { base, target } = this.resolvedLexicalPaths(absolutePath)
    const [realBase, resolvedTarget] = await Promise.all([
      this.realVaultBase(base),
      this.resolveRealPathIfPresent(target),
    ])
    if (!resolvedTarget) {
      throw new FsBridgeError(`File not found: ${absolutePath}`)
    }
    this.assertResolvedInside(realBase, resolvedTarget, absolutePath)
  }

  /**
   * Resolves the target or its closest existing ancestor. This catches a
   * symlink/junction in an otherwise not-yet-created path before any mkdir.
   */
  private async assertWritablePathInside(absolutePath: string): Promise<void> {
    const { base, target } = this.resolvedLexicalPaths(absolutePath)
    const realBase = await this.realVaultBase(base)
    const platformPath = this.platformPath()
    let candidate = target

    while (true) {
      const resolved = await this.resolveRealPathIfPresent(candidate)
      if (resolved) {
        this.assertResolvedInside(realBase, resolved, absolutePath)
        if (candidate !== target) {
          const details = await this.fileSystem.lstat(resolved)
          if (!details.isDirectory()) {
            throw new FsBridgeError(
              `Parent path is not a directory: ${candidate}`,
            )
          }
        }
        return
      }

      const parent = platformPath.dirname(candidate)
      if (parent === candidate) {
        throw new FsBridgeError(
          `No existing parent found for path: ${absolutePath}`,
        )
      }
      candidate = parent
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async readTextFile(
    params: ReadTextFileRequest,
  ): Promise<ReadTextFileResponse> {
    const relative = this.toVaultRelativePath(params.path)
    const adapter = this.app.vault.adapter
    if (!(await adapter.exists(relative))) {
      throw new FsBridgeError(`File not found: ${params.path}`)
    }
    // Keep the realpath check adjacent to the read to narrow the unavoidable
    // check/use window in the adapter API.
    await this.assertExistingPathInside(params.path)
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
    await this.assertWritablePathInside(params.path)
    await this.ensureParentFolder(relative)
    // Re-resolve immediately before write: mkdir or another actor may have
    // replaced a checked parent with a symlink/junction in the meantime.
    await this.assertWritablePathInside(params.path)
    await this.app.vault.adapter.write(relative, params.content)
    return {}
  }

  private async ensureParentFolder(relativePath: string): Promise<void> {
    const segments = relativePath.split('/')
    segments.pop()
    if (segments.length === 0) return
    const platformPath = this.platformPath()
    const base = platformPath.resolve(this.vaultBasePath())
    let current = ''
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment
      if (!(await this.app.vault.adapter.exists(current))) {
        try {
          await this.app.vault.adapter.mkdir(current)
        } catch (error) {
          // Concurrent bridge calls may both observe a missing directory. If
          // one won the race, validate that directory and continue.
          if (!(await this.app.vault.adapter.exists(current))) throw error
        }
      }
      const absoluteCurrent = platformPath.resolve(base, ...current.split('/'))
      await this.assertExistingPathInside(absoluteCurrent)
    }
  }
}
