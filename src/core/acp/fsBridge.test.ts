import type { App } from 'obsidian'

import { FsBridge, FsBridgeError } from './fsBridge'

type AdapterMock = {
  getBasePath: () => string
  exists: jest.Mock<Promise<boolean>, [string]>
  read: jest.Mock<Promise<string>, [string]>
  write: jest.Mock<Promise<void>, [string, string]>
  mkdir: jest.Mock<Promise<void>, [string]>
}

function makeApp(basePath = '/vault/root'): { app: App; adapter: AdapterMock } {
  const adapter: AdapterMock = {
    getBasePath: () => basePath,
    exists: jest.fn((_path: string) => Promise.resolve(true)),
    read: jest.fn((_path: string) => Promise.resolve('file content')),
    write: jest.fn((_path: string, _content: string) => Promise.resolve()),
    mkdir: jest.fn((_path: string) => Promise.resolve()),
  }
  const app = { vault: { adapter } } as unknown as App
  return { app, adapter }
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

describe('FsBridge', () => {
  it('reads a file inside the vault', async () => {
    const { app, adapter } = makeApp()
    const bridge = new FsBridge(app)
    const response = await bridge.readTextFile({
      sessionId: 's1',
      path: '/vault/root/notes/a.md',
    })
    expect(response).toEqual({ content: 'file content' })
    expect(adapter.read).toHaveBeenCalledWith('notes/a.md')
  })

  it('applies line and limit slicing (1-based)', async () => {
    const { app, adapter } = makeApp()
    adapter.read.mockResolvedValue('l1\nl2\nl3\nl4')
    const bridge = new FsBridge(app)
    const response = await bridge.readTextFile({
      sessionId: 's1',
      path: '/vault/root/a.md',
      line: 2,
      limit: 2,
    })
    expect(response.content).toBe('l2\nl3')
  })

  it('rejects paths outside the vault', async () => {
    const { app } = makeApp()
    const bridge = new FsBridge(app)
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
    const { app } = makeApp()
    const bridge = new FsBridge(app)
    await expect(
      bridge.readTextFile({ sessionId: 's1', path: '/vault/root' }),
    ).rejects.toBeInstanceOf(FsBridgeError)
  })

  it('rejects relative paths', () => {
    const { app } = makeApp()
    const bridge = new FsBridge(app)
    expect(() => bridge.toVaultRelativePath('notes/a.md')).toThrow(
      FsBridgeError,
    )
  })

  it('resolves Unix dot segments before checking the vault boundary', () => {
    const { app } = makeApp()
    const bridge = new FsBridge(app)

    expect(bridge.toVaultRelativePath('/vault/root/notes/../safe.md')).toBe(
      'safe.md',
    )
    expect(() =>
      bridge.toVaultRelativePath('/vault/root/notes/../../outside.md'),
    ).toThrow(FsBridgeError)
  })

  it('throws when reading a missing file', async () => {
    const { app, adapter } = makeApp()
    adapter.exists.mockResolvedValue(false)
    const bridge = new FsBridge(app)
    await expect(
      bridge.readTextFile({ sessionId: 's1', path: '/vault/root/no.md' }),
    ).rejects.toThrow('File not found')
  })

  it('writes a file, creating parent folders as needed', async () => {
    const { app, adapter } = makeApp()
    adapter.exists.mockImplementation(async (p: string) => p !== 'a/b')
    const bridge = new FsBridge(app)
    await bridge.writeTextFile({
      sessionId: 's1',
      path: '/vault/root/a/b/c.md',
      content: 'hello',
    })
    expect(adapter.write).toHaveBeenCalledWith('a/b/c.md', 'hello')
  })

  it('normalizes windows-style separators', async () => {
    await withPlatform('win32', async () => {
      const { app, adapter } = makeApp('C:/vault')
      const bridge = new FsBridge(app)
      await bridge.readTextFile({
        sessionId: 's1',
        path: 'C:\\vault\\notes\\a.md',
      })
      expect(adapter.read).toHaveBeenCalledWith('notes/a.md')
    })
  })

  it('matches drive letter case-insensitively on win32', async () => {
    await withPlatform('win32', async () => {
      const { app, adapter } = makeApp('C:/vault')
      const bridge = new FsBridge(app)
      await bridge.readTextFile({
        sessionId: 's1',
        path: 'c:/vault/notes/a.md',
      })
      expect(adapter.read).toHaveBeenCalledWith('notes/a.md')
    })
  })

  it('resolves Windows dot segments before checking the vault boundary', async () => {
    await withPlatform('win32', () => {
      const { app } = makeApp('C:\\vault\\root')
      const bridge = new FsBridge(app)

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
