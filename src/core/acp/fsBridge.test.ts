import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import * as os from 'node:os'
import * as nodePath from 'node:path'

import type { App } from 'obsidian'

import type { FsBridgeFileSystem } from './fsBridge'
import { FsBridge, FsBridgeError } from './fsBridge'

type AdapterMock = {
  getBasePath: () => string
  exists: jest.Mock<Promise<boolean>, [string]>
  read: jest.Mock<Promise<string>, [string]>
  write: jest.Mock<Promise<void>, [string, string]>
  mkdir: jest.Mock<Promise<void>, [string]>
}

type FileSystemMock = {
  lstat: jest.MockedFunction<FsBridgeFileSystem['lstat']>
  realpath: jest.MockedFunction<FsBridgeFileSystem['realpath']>
}

function makeFileSystemMock(): FileSystemMock {
  return {
    lstat: jest.fn(async (_filePath: string) => ({ isDirectory: () => true })),
    realpath: jest.fn(async (filePath: string) => filePath),
  }
}

function makeApp(basePath = '/vault/root'): {
  adapter: AdapterMock
  app: App
  bridge: FsBridge
  fileSystem: FileSystemMock
} {
  const adapter: AdapterMock = {
    getBasePath: () => basePath,
    exists: jest.fn((_path: string) => Promise.resolve(true)),
    read: jest.fn((_path: string) => Promise.resolve('file content')),
    write: jest.fn((_path: string, _content: string) => Promise.resolve()),
    mkdir: jest.fn((_path: string) => Promise.resolve()),
  }
  const app = { vault: { adapter } } as unknown as App
  const fileSystem = makeFileSystemMock()
  return {
    adapter,
    app,
    bridge: new FsBridge(app, fileSystem),
    fileSystem,
  }
}

function makeRealApp(basePath: string): { adapter: AdapterMock; app: App } {
  const absolute = (relative: string) =>
    nodePath.join(basePath, ...relative.split('/'))
  const adapter: AdapterMock = {
    getBasePath: () => basePath,
    exists: jest.fn(async (relative: string) => {
      try {
        await access(absolute(relative))
        return true
      } catch {
        return false
      }
    }),
    read: jest.fn((relative: string) => readFile(absolute(relative), 'utf8')),
    write: jest.fn(async (relative: string, content: string) => {
      await writeFile(absolute(relative), content)
    }),
    mkdir: jest.fn(async (relative: string) => {
      await mkdir(absolute(relative))
    }),
  }
  return { adapter, app: { vault: { adapter } } as unknown as App }
}

async function withTemporaryVault(
  callback: (paths: {
    outside: string
    root: string
    vault: string
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(nodePath.join(os.tmpdir(), 'openyolo-fsbridge-'))
  const vault = nodePath.join(root, 'vault')
  const outside = nodePath.join(root, 'outside')
  await Promise.all([mkdir(vault), mkdir(outside)])
  try {
    await callback({ outside, root, vault })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}

async function createDirectoryLink(target: string, linkPath: string) {
  await symlink(
    target,
    linkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}

async function withPlatform<T>(
  platform: NodeJS.Platform,
  callback: () => T | Promise<T>,
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    return await callback()
  } finally {
    if (original) Object.defineProperty(process, 'platform', original)
  }
}

function missingPathError(): NodeJS.ErrnoException {
  return Object.assign(new Error('not found'), { code: 'ENOENT' })
}

describe('FsBridge', () => {
  it('reads a file inside the vault', async () => {
    const { adapter, bridge } = makeApp()
    const response = await bridge.readTextFile({
      sessionId: 's1',
      path: '/vault/root/notes/a.md',
    })
    expect(response).toEqual({ content: 'file content' })
    expect(adapter.read).toHaveBeenCalledWith('notes/a.md')
  })

  it('applies line and limit slicing (1-based)', async () => {
    const { adapter, bridge } = makeApp()
    adapter.read.mockResolvedValue('l1\nl2\nl3\nl4')
    const response = await bridge.readTextFile({
      sessionId: 's1',
      path: '/vault/root/a.md',
      line: 2,
      limit: 2,
    })
    expect(response.content).toBe('l2\nl3')
  })

  it('rejects paths outside the vault', async () => {
    const { bridge } = makeApp()
    await expect(
      bridge.readTextFile({ sessionId: 's1', path: '/etc/passwd' }),
    ).rejects.toBeInstanceOf(FsBridgeError)
    await expect(
      bridge.writeTextFile({
        sessionId: 's1',
        path: '/vault/root2/x.md',
        content: 'x',
      }),
    ).rejects.toBeInstanceOf(FsBridgeError)
  })

  it('rejects the vault root path itself', async () => {
    const { bridge } = makeApp()
    await expect(
      bridge.readTextFile({ sessionId: 's1', path: '/vault/root' }),
    ).rejects.toBeInstanceOf(FsBridgeError)
  })

  it('rejects relative paths', () => {
    const { bridge } = makeApp()
    expect(() => bridge.toVaultRelativePath('notes/a.md')).toThrow(
      FsBridgeError,
    )
  })

  it('resolves Unix dot segments before checking the vault boundary', () => {
    const { bridge } = makeApp()
    expect(bridge.toVaultRelativePath('/vault/root/notes/../safe.md')).toBe(
      'safe.md',
    )
    expect(() =>
      bridge.toVaultRelativePath('/vault/root/notes/../../outside.md'),
    ).toThrow(FsBridgeError)
  })

  it('throws when reading a missing file', async () => {
    const { adapter, bridge } = makeApp()
    adapter.exists.mockResolvedValue(false)
    await expect(
      bridge.readTextFile({ sessionId: 's1', path: '/vault/root/no.md' }),
    ).rejects.toThrow('File not found')
  })

  it('writes a file, creating parent folders as needed', async () => {
    const { adapter, bridge } = makeApp()
    adapter.exists.mockImplementation(async (candidate: string) => {
      return candidate !== 'a/b'
    })
    await bridge.writeTextFile({
      sessionId: 's1',
      path: '/vault/root/a/b/c.md',
      content: 'hello',
    })
    expect(adapter.mkdir).toHaveBeenCalledWith('a/b')
    expect(adapter.write).toHaveBeenCalledWith('a/b/c.md', 'hello')
  })

  it('blocks reads through a vault symlink or junction to the outside', async () => {
    await withTemporaryVault(async ({ outside, vault }) => {
      await writeFile(nodePath.join(outside, 'secret.md'), 'secret')
      await createDirectoryLink(outside, nodePath.join(vault, 'escape'))
      const { adapter, app } = makeRealApp(vault)
      const bridge = new FsBridge(app)

      await expect(
        bridge.readTextFile({
          sessionId: 's1',
          path: nodePath.join(vault, 'escape', 'secret.md'),
        }),
      ).rejects.toThrow('resolves outside the vault')
      expect(adapter.read).not.toHaveBeenCalled()
    })
  })

  it('blocks a new write whose existing real parent is outside', async () => {
    await withTemporaryVault(async ({ outside, vault }) => {
      await createDirectoryLink(outside, nodePath.join(vault, 'escape'))
      const { adapter, app } = makeRealApp(vault)
      const bridge = new FsBridge(app)

      await expect(
        bridge.writeTextFile({
          sessionId: 's1',
          path: nodePath.join(vault, 'escape', 'new', 'note.md'),
          content: 'must stay inside',
        }),
      ).rejects.toThrow('resolves outside the vault')
      expect(adapter.mkdir).not.toHaveBeenCalled()
      expect(adapter.write).not.toHaveBeenCalled()
    })
  })

  it('allows a symlink whose resolved target remains inside the vault', async () => {
    await withTemporaryVault(async ({ vault }) => {
      const realDirectory = nodePath.join(vault, 'real')
      await mkdir(realDirectory)
      await writeFile(nodePath.join(realDirectory, 'note.md'), 'inside')
      await createDirectoryLink(realDirectory, nodePath.join(vault, 'alias'))
      const { app } = makeRealApp(vault)
      const bridge = new FsBridge(app)

      await expect(
        bridge.readTextFile({
          sessionId: 's1',
          path: nodePath.join(vault, 'alias', 'note.md'),
        }),
      ).resolves.toEqual({ content: 'inside' })
    })
  })

  it('creates and revalidates real parent directories for a new path', async () => {
    await withTemporaryVault(async ({ vault }) => {
      const { app } = makeRealApp(vault)
      const bridge = new FsBridge(app)
      const target = nodePath.join(vault, 'new', 'nested', 'note.md')

      await bridge.writeTextFile({
        sessionId: 's1',
        path: target,
        content: 'hello',
      })

      await expect(readFile(target, 'utf8')).resolves.toBe('hello')
    })
  })

  it('rechecks the parent immediately before write to narrow TOCTOU', async () => {
    const { adapter, app, fileSystem } = makeApp()
    adapter.exists.mockResolvedValue(true)
    let parentResolutions = 0
    fileSystem.lstat.mockImplementation(async (candidate: string) => {
      if (candidate.endsWith('note.md')) throw missingPathError()
      return { isDirectory: () => true }
    })
    fileSystem.realpath.mockImplementation(async (candidate: string) => {
      if (candidate.endsWith('/parent')) {
        parentResolutions += 1
        if (parentResolutions >= 3) return '/outside/parent'
      }
      return candidate
    })
    const bridge = new FsBridge(app, fileSystem)

    await expect(
      bridge.writeTextFile({
        sessionId: 's1',
        path: '/vault/root/parent/note.md',
        content: 'blocked',
      }),
    ).rejects.toThrow('resolves outside the vault')
    expect(adapter.write).not.toHaveBeenCalled()
  })

  it('tolerates a concurrent mkdir winner after an EEXIST race', async () => {
    const { adapter, bridge } = makeApp()
    let parentExistsChecks = 0
    adapter.exists.mockImplementation(async (candidate: string) => {
      if (candidate !== 'shared') return true
      parentExistsChecks += 1
      return parentExistsChecks > 2
    })
    let mkdirCalls = 0
    adapter.mkdir.mockImplementation(async () => {
      mkdirCalls += 1
      if (mkdirCalls === 2) {
        throw Object.assign(new Error('already exists'), { code: 'EEXIST' })
      }
    })

    await Promise.all([
      bridge.writeTextFile({
        sessionId: 's1',
        path: '/vault/root/shared/one.md',
        content: 'one',
      }),
      bridge.writeTextFile({
        sessionId: 's2',
        path: '/vault/root/shared/two.md',
        content: 'two',
      }),
    ])

    expect(adapter.mkdir).toHaveBeenCalledTimes(2)
    expect(adapter.write).toHaveBeenCalledTimes(2)
  })

  it('normalizes windows-style separators', async () => {
    await withPlatform('win32', async () => {
      const { adapter, bridge } = makeApp('C:/vault')
      await bridge.readTextFile({
        sessionId: 's1',
        path: 'C:\\vault\\notes\\a.md',
      })
      expect(adapter.read).toHaveBeenCalledWith('notes/a.md')
    })
  })

  it('matches drive letter case-insensitively on win32', async () => {
    await withPlatform('win32', async () => {
      const { adapter, bridge } = makeApp('C:/vault')
      await bridge.readTextFile({
        sessionId: 's1',
        path: 'c:/vault/notes/a.md',
      })
      expect(adapter.read).toHaveBeenCalledWith('notes/a.md')
    })
  })

  it('resolves Windows dot segments before checking the vault boundary', async () => {
    await withPlatform('win32', () => {
      const { bridge } = makeApp('C:\\vault\\root')
      expect(
        bridge.toVaultRelativePath('c:\\vault\\root\\notes\\..\\safe.md'),
      ).toBe('safe.md')
      expect(() =>
        bridge.toVaultRelativePath(
          'C:\\vault\\root\\notes\\..\\..\\outside.md',
        ),
      ).toThrow(FsBridgeError)
    })
  })
})
