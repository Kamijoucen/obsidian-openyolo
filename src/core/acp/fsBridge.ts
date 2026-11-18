import { lstat, realpath } from 'node:fs/promises'
import * as path from 'node:path'

import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk/unstable'
import type { App, FileSystemAdapter } from 'obsidian'
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

type VaultPath = {
  adapter: FileSystemAdapter
  base: string
  relative: string
  target: string
}

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

  private resolveVaultPath(absolutePath: string): VaultPath {
    const platformPath = this.platformPath()
    const adapter = this.app.vault.adapter as FileSystemAdapter
    if (
      typeof adapter.getBasePath !== 'function' ||
      typeof adapter.getFullPath !== 'function'
    ) {
      throw new FsBridgeError('Vault disk paths are not available')
    }
    const basePath = adapter.getBasePath()
    if (!platformPath.isAbsolute(basePath)) {
      throw new FsBridgeError(`Vault base path is not absolute: ${basePath}`)
    }
    if (!platformPath.isAbsolute(absolutePath)) {
      throw new FsBridgeError(`Path is not absolute: ${absolutePath}`)
    }

    const base = platformPath.resolve(basePath)
    const requestedRelative = platformPath.relative(base, absolutePath)
    if (requestedRelative === '') {
      throw new FsBridgeError(`Path is the vault root: ${absolutePath}`)
    }
    if (this.isOutside(requestedRelative)) {
      throw new FsBridgeError(`Path is outside the vault: ${absolutePath}`)
    }
    if (process.platform !== 'win32' && requestedRelative.includes('\\')) {
      throw new FsBridgeError(`Ambiguous vault path: ${absolutePath}`)
    }
    const forwardPath = toForwardSlashes(requestedRelative)
    const relative = normalizePath(forwardPath)
    if (relative !== forwardPath && relative !== forwardPath.normalize('NFC')) {
      throw new FsBridgeError(`Ambiguous vault path: ${absolutePath}`)
    }
    const target = this.adapterTarget(adapter, base, relative)
    return { adapter, base, relative, target }
  }

  private adapterTarget(
    adapter: FileSystemAdapter,
    base: string,
    relative: string,
  ): string {
    const platformPath = this.platformPath()
    // Use the disk path the adapter derives from the same key it will read or
    // write. Obsidian's key normalization can change its spelling on disk.
    const target = adapter.getFullPath(relative)
    const targetRelative = platformPath.relative(base, target)
    if (
      !platformPath.isAbsolute(target) ||
      !targetRelative ||
      this.isOutside(targetRelative)
    ) {
      throw new FsBridgeError(`Adapter path is outside the vault: ${relative}`)
    }
    return target
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
    return this.resolveVaultPath(absolutePath).relative
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

  private async assertExistingPathInside(
    realBase: string,
    target: string,
  ): Promise<void> {
    const resolvedTarget = await this.resolveRealPathIfPresent(target)
    if (!resolvedTarget) {
      throw new FsBridgeError(`File not found: ${target}`)
    }
    this.assertResolvedInside(realBase, resolvedTarget, target)
  }

  /**
   * Resolves the target or its closest existing ancestor. This catches a
   * symlink/junction in an otherwise not-yet-created path before any mkdir.
   */
  private async assertWritablePathInside(
    realBase: string,
    target: string,
  ): Promise<void> {
    const platformPath = this.platformPath()
    let candidate = target

    while (true) {
      const resolved = await this.resolveRealPathIfPresent(candidate)
      if (resolved) {
        this.assertResolvedInside(realBase, resolved, target)
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
        throw new FsBridgeError(`No existing parent found for path: ${target}`)
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
    const { adapter, base, relative, target } = this.resolveVaultPath(
      params.path,
    )
    const realBase = await this.realVaultBase(base)
    // Keep the realpath check adjacent to the read to narrow the unavoidable
    // check/use window in the adapter API.
    await this.assertExistingPathInside(realBase, target)
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
    const destination = this.resolveVaultPath(params.path)
    const { adapter, base, relative, target } = destination
    const realBase = await this.realVaultBase(base)
    await this.assertWritablePathInside(realBase, target)
    await this.ensureParentFolder(destination, realBase)
    // Re-resolve immediately before write: mkdir or another actor may have
    // changed the adapter's path mapping or a symlink in the meantime.
    await this.assertWritablePathInside(
      realBase,
      this.adapterTarget(adapter, base, relative),
    )
    await adapter.write(relative, params.content)
    return {}
  }

  private async ensureParentFolder(
    { adapter, base, relative }: VaultPath,
    realBase: string,
  ): Promise<void> {
    const segments = relative.split('/')
    segments.pop()
    let current = ''
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment
      this.adapterTarget(adapter, base, current)
      if (!(await adapter.exists(current))) {
        await this.assertWritablePathInside(
          realBase,
          this.adapterTarget(adapter, base, current),
        )
        try {
          await adapter.mkdir(current)
        } catch (error) {
          // Concurrent bridge calls may both observe a missing directory. If
          // one won the race, validate that directory and continue.
          if (!(await adapter.exists(current))) throw error
        }
      }
      await this.assertExistingPathInside(
        realBase,
        this.adapterTarget(adapter, base, current),
      )
    }
  }
}
