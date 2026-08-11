import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type { App } from 'obsidian'

import type { ChatSessionState, TimelineEntry } from '../types/chat'

import { chatLogDateFolder } from './chatLog'
import {
  ensureSessionMapDir,
  lookupSessionMapping,
  recordSessionMapping,
  removeSessionMapping,
  saveConversationWithMap,
} from './sessionMap'

function makeState(
  entries: TimelineEntry[],
  sessionId: string,
  title = '测试会话',
): ChatSessionState {
  return {
    sessionId,
    title,
    status: 'idle',
    awaitingResponse: false,
    error: null,
    entries,
    plan: [],
    usage: null,
    mode: null,
    commands: [],
    configOptions: [],
    lastStopReason: null,
  }
}

function userEntry(text: string): TimelineEntry {
  return {
    kind: 'user',
    id: `u-${text}`,
    messageId: null,
    timestamp: 1,
    text,
    blocks: [],
  }
}

type FakeFile = { path: string }

function makeVault() {
  const files = new Map<string, string>()
  const folders = new Set<string>()
  const vault = {
    files,
    folders,
    getFileByPath: (path: string): FakeFile | null =>
      files.has(path) ? { path } : null,
    getAbstractFileByPath: (path: string): FakeFile | null =>
      files.has(path) || folders.has(path) ? { path } : null,
    process: (file: FakeFile, fn: (data: string) => string) => {
      files.set(file.path, fn(files.get(file.path) ?? ''))
      return Promise.resolve('')
    },
    create: (path: string, data: string): Promise<FakeFile> => {
      if (files.has(path)) throw new Error('already exists')
      files.set(path, data)
      return Promise.resolve({ path })
    },
    createFolder: (path: string): Promise<FakeFile> => {
      folders.add(path)
      return Promise.resolve({ path })
    },
    adapter: {
      getBasePath: () => VAULT_KEY,
      read: (path: string) => {
        const content = files.get(path)
        return content === undefined
          ? Promise.reject(new Error('missing'))
          : Promise.resolve(content)
      },
      list: (folder: string) => {
        const prefix = folder ? `${folder}/` : ''
        const direct: string[] = []
        const subFolders = new Set<string>()
        for (const path of files.keys()) {
          if (!path.startsWith(prefix)) continue
          const rest = path.slice(prefix.length)
          if (rest.includes('/')) {
            subFolders.add(`${prefix}${rest.split('/')[0]}`)
          } else {
            direct.push(path)
          }
        }
        return Promise.resolve({ files: direct, folders: [...subFolders] })
      },
      stat: (path: string) =>
        files.has(path)
          ? Promise.resolve({ type: 'file', ctime: 1, mtime: 1, size: 1 })
          : Promise.resolve(null),
    },
  }
  return vault
}

function asApp(vault: ReturnType<typeof makeVault>): App {
  return { vault } as unknown as App
}

async function makeHome(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'openyolo-test-'))
}

async function readMapFile(home: string): Promise<unknown> {
  const raw = await fs.readFile(
    join(home, '.openyolo', 'session-map.json'),
    'utf8',
  )
  return JSON.parse(raw)
}

const VAULT_KEY = '/vault'

describe('session map store', () => {
  it('creates ~/.openyolo on demand', async () => {
    const home = await makeHome()
    await ensureSessionMapDir(home)
    await expect(fs.stat(join(home, '.openyolo'))).resolves.toBeTruthy()
  })

  it('records, looks up and removes mappings', async () => {
    const home = await makeHome()
    await recordSessionMapping(
      VAULT_KEY,
      'ses_new',
      { id: 'ses_original', path: 'YOLO/2026-08-10/a.md' },
      home,
    )
    await expect(
      lookupSessionMapping(VAULT_KEY, 'ses_new', home),
    ).resolves.toEqual({ id: 'ses_original', path: 'YOLO/2026-08-10/a.md' })

    await removeSessionMapping(VAULT_KEY, 'ses_new', home)
    await expect(
      lookupSessionMapping(VAULT_KEY, 'ses_new', home),
    ).resolves.toBeNull()
  })

  it('tolerates a corrupted map file and rewrites it on record', async () => {
    const home = await makeHome()
    await ensureSessionMapDir(home)
    await fs.writeFile(join(home, '.openyolo', 'session-map.json'), 'not json{')
    await expect(
      lookupSessionMapping(VAULT_KEY, 'ses_x', home),
    ).resolves.toBeNull()
    await recordSessionMapping(
      VAULT_KEY,
      'ses_x',
      { id: 'ses_x', path: 'YOLO/a.md' },
      home,
    )
    await expect(
      lookupSessionMapping(VAULT_KEY, 'ses_x', home),
    ).resolves.toEqual({ id: 'ses_x', path: 'YOLO/a.md' })
  })

  it('scopes mappings per vault key', async () => {
    const home = await makeHome()
    await recordSessionMapping(
      VAULT_KEY,
      'ses_a',
      { id: 'ses_a', path: 'YOLO/a.md' },
      home,
    )
    await expect(
      lookupSessionMapping('/other-vault', 'ses_a', home),
    ).resolves.toBeNull()
  })

  it('serializes concurrent records without losing entries', async () => {
    const home = await makeHome()
    await Promise.all([
      recordSessionMapping(
        VAULT_KEY,
        'ses_1',
        { id: 'ses_1', path: 'a.md' },
        home,
      ),
      recordSessionMapping(
        VAULT_KEY,
        'ses_2',
        { id: 'ses_2', path: 'b.md' },
        home,
      ),
      recordSessionMapping(
        '/other',
        'ses_3',
        { id: 'ses_3', path: 'c.md' },
        home,
      ),
    ])
    await expect(
      lookupSessionMapping(VAULT_KEY, 'ses_1', home),
    ).resolves.toEqual({ id: 'ses_1', path: 'a.md' })
    await expect(
      lookupSessionMapping(VAULT_KEY, 'ses_2', home),
    ).resolves.toEqual({ id: 'ses_2', path: 'b.md' })
    await expect(
      lookupSessionMapping('/other', 'ses_3', home),
    ).resolves.toEqual({ id: 'ses_3', path: 'c.md' })
  })

  it('drops the vault bucket when its last mapping is removed', async () => {
    const home = await makeHome()
    await recordSessionMapping(
      VAULT_KEY,
      'ses_a',
      { id: 'ses_a', path: 'a.md' },
      home,
    )
    await removeSessionMapping(VAULT_KEY, 'ses_a', home)
    const file = (await readMapFile(home)) as Record<string, unknown>
    expect(file[VAULT_KEY]).toBeUndefined()
    await expect(
      removeSessionMapping(VAULT_KEY, 'ses_missing', home),
    ).resolves.toBeUndefined()
  })

  it('returns null for malformed entries', async () => {
    const home = await makeHome()
    await ensureSessionMapDir(home)
    await fs.writeFile(
      join(home, '.openyolo', 'session-map.json'),
      JSON.stringify({
        [VAULT_KEY]: {
          bad1: { id: 1, path: 'a.md' },
          bad2: { id: 'ses_x' },
          bad3: 'not-an-object',
        },
      }),
    )
    await expect(
      lookupSessionMapping(VAULT_KEY, 'bad1', home),
    ).resolves.toBeNull()
    await expect(
      lookupSessionMapping(VAULT_KEY, 'bad2', home),
    ).resolves.toBeNull()
    await expect(
      lookupSessionMapping(VAULT_KEY, 'bad3', home),
    ).resolves.toBeNull()
  })
})

describe('saveConversationWithMap', () => {
  it('falls back to the old logic and records the mapping afterwards', async () => {
    const home = await makeHome()
    const vault = makeVault()
    const state = makeState([userEntry('你好')], 'ses_new')
    const path = await saveConversationWithMap(
      asApp(vault),
      'YOLO',
      state,
      home,
    )
    expect(path).toBe(`YOLO/${chatLogDateFolder(new Date())}/测试会话.md`)
    expect(vault.files.get(path!)).toContain(
      '<!-- openyolo-session: ses_new -->',
    )
    const file = (await readMapFile(home)) as Record<
      string,
      Record<string, { id: string; path: string }>
    >
    expect(file[VAULT_KEY]['ses_new']).toEqual({ id: 'ses_new', path })
  })

  it('overwrites the mapped note and keeps the original session marker', async () => {
    const home = await makeHome()
    const vault = makeVault()
    vault.files.set(
      'YOLO/2026-08-10/原始.md',
      '<!-- openyolo-session: ses_original -->\n旧内容',
    )
    await recordSessionMapping(
      VAULT_KEY,
      'ses_restored',
      { id: 'ses_original', path: 'YOLO/2026-08-10/原始.md' },
      home,
    )
    const state = makeState([userEntry('继续聊')], 'ses_restored')
    const path = await saveConversationWithMap(
      asApp(vault),
      'YOLO',
      state,
      home,
    )
    expect(path).toBe('YOLO/2026-08-10/原始.md')
    expect(vault.files.get(path!)).toContain('继续聊')
    expect(vault.files.get(path!)).toContain(
      '<!-- openyolo-session: ses_original -->',
    )
    expect(vault.files.get(path!)).toContain(
      '<!-- openyolo-segment: ses_restored -->',
    )
  })

  it('heals a stale path via the original id and updates the mapping', async () => {
    const home = await makeHome()
    const vault = makeVault()
    vault.files.set(
      'YOLO/2026-08-09/移动后.md',
      '<!-- openyolo-session: ses_original -->\n旧内容',
    )
    await recordSessionMapping(
      VAULT_KEY,
      'ses_restored',
      { id: 'ses_original', path: 'YOLO/2026-08-09/旧位置.md' },
      home,
    )
    const state = makeState([userEntry('又聊了一句')], 'ses_restored')
    const path = await saveConversationWithMap(
      asApp(vault),
      'YOLO',
      state,
      home,
    )
    expect(path).toBe('YOLO/2026-08-09/移动后.md')
    expect(vault.files.get(path!)).toContain('又聊了一句')
    const file = (await readMapFile(home)) as Record<
      string,
      Record<string, { id: string; path: string }>
    >
    expect(file[VAULT_KEY]['ses_restored']).toEqual({
      id: 'ses_original',
      path: 'YOLO/2026-08-09/移动后.md',
    })
  })

  it('merges restored-session content into the original note, preserving history', async () => {
    const home = await makeHome()
    const vault = makeVault()
    vault.files.set(
      'YOLO/2026-08-10/原始.md',
      [
        '<!-- openyolo-session: ses_original -->',
        '',
        '# OpenYOLO conversation history',
        '',
        '## User',
        '',
        '最初的问题',
        '',
        '## Assistant',
        '',
        '最初的回答',
        '',
      ].join('\n'),
    )
    await recordSessionMapping(
      VAULT_KEY,
      'ses_restored',
      { id: 'ses_original', path: 'YOLO/2026-08-10/原始.md' },
      home,
    )
    const state = makeState(
      [userEntry('附件笔记中保存着我们之前的对话记录…'), userEntry('继续追问')],
      'ses_restored',
      '原始',
    )
    const path = await saveConversationWithMap(
      asApp(vault),
      'YOLO',
      state,
      home,
    )
    expect(path).toBe('YOLO/2026-08-10/原始.md')
    const saved = vault.files.get(path!)
    expect(saved).toContain('<!-- openyolo-session: ses_original -->')
    expect(saved).toContain('最初的回答')
    expect(saved).toContain('继续追问')
    expect(saved!.indexOf('最初的回答')).toBeLessThan(
      saved!.indexOf('继续追问'),
    )
    expect(saved!.match(/# OpenYOLO conversation history/g)).toHaveLength(1)

    const again = makeState(
      [
        userEntry('附件笔记中保存着我们之前的对话记录…'),
        userEntry('继续追问'),
        userEntry('又一条消息'),
      ],
      'ses_restored',
      '原始',
    )
    const path2 = await saveConversationWithMap(
      asApp(vault),
      'YOLO',
      again,
      home,
    )
    expect(path2).toBe(path)
    const saved2 = vault.files.get(path2!)
    expect(saved2).toContain('又一条消息')
    expect(saved2!.match(/继续追问/g)).toHaveLength(1)
    expect(saved2!.match(/最初的回答/g)).toHaveLength(1)
    expect(saved2!.match(/# OpenYOLO conversation history/g)).toHaveLength(1)
  })

  it('drops a stale mapping when the note is gone, then saves a new file', async () => {
    const home = await makeHome()
    const vault = makeVault()
    await recordSessionMapping(
      VAULT_KEY,
      'ses_restored',
      { id: 'ses_original', path: 'YOLO/2026-08-09/已删除.md' },
      home,
    )
    const state = makeState([userEntry('重新开始')], 'ses_restored')
    const path = await saveConversationWithMap(
      asApp(vault),
      'YOLO',
      state,
      home,
    )
    expect(path).toBe(`YOLO/${chatLogDateFolder(new Date())}/测试会话.md`)
    expect(vault.files.get(path!)).toContain(
      '<!-- openyolo-session: ses_restored -->',
    )
    const file = (await readMapFile(home)) as Record<
      string,
      Record<string, { id: string; path: string }>
    >
    expect(file[VAULT_KEY]['ses_restored']).toEqual({
      id: 'ses_restored',
      path,
    })
  })

  it('returns null without touching the map when there is nothing to save', async () => {
    const home = await makeHome()
    const vault = makeVault()
    await recordSessionMapping(
      VAULT_KEY,
      'ses_restored',
      { id: 'ses_original', path: 'YOLO/a.md' },
      home,
    )
    const state = makeState([], 'ses_restored')
    await expect(
      saveConversationWithMap(asApp(vault), 'YOLO', state, home),
    ).resolves.toBeNull()
    expect(vault.files.size).toBe(0)
    await expect(
      lookupSessionMapping(VAULT_KEY, 'ses_restored', home),
    ).resolves.toEqual({ id: 'ses_original', path: 'YOLO/a.md' })
  })

  it('bypasses the map entirely when the state has no session id', async () => {
    const home = await makeHome()
    const vault = makeVault()
    const state = { ...makeState([userEntry('无会话')], 'x'), sessionId: null }
    const path = await saveConversationWithMap(
      asApp(vault),
      'YOLO',
      state,
      home,
    )
    expect(path).toContain('YOLO/')
    await expect(
      fs.stat(join(home, '.openyolo', 'session-map.json')),
    ).rejects.toThrow()
  })

  it('falls back to a new file when the mapped path is a folder', async () => {
    const home = await makeHome()
    const vault = makeVault()
    const today = chatLogDateFolder(new Date())
    vault.folders.add(`YOLO/${today}/测试会话.md`)
    await recordSessionMapping(
      VAULT_KEY,
      'ses_a',
      { id: 'ses_a', path: 'YOLO/2026-08-10/测试会话.md' },
      home,
    )
    const state = makeState([userEntry('重存')], 'ses_a')
    const path = await saveConversationWithMap(
      asApp(vault),
      'YOLO',
      state,
      home,
    )
    expect(path).toBe(`YOLO/${today}/测试会话-sesa.md`)
    expect(vault.files.get(path!)).toContain('重存')
    await expect(
      lookupSessionMapping(VAULT_KEY, 'ses_a', home),
    ).resolves.toEqual({ id: 'ses_a', path })
  })

  it('writes plain content when the mapped note is empty', async () => {
    const home = await makeHome()
    const vault = makeVault()
    vault.files.set('YOLO/a.md', '')
    await recordSessionMapping(
      VAULT_KEY,
      'ses_restored',
      { id: 'ses_original', path: 'YOLO/a.md' },
      home,
    )
    const state = makeState([userEntry('新内容')], 'ses_restored')
    const path = await saveConversationWithMap(
      asApp(vault),
      'YOLO',
      state,
      home,
    )
    expect(path).toBe('YOLO/a.md')
    expect(vault.files.get(path!)).toContain('新内容')
    expect(vault.files.get(path!)).not.toContain('openyolo-segment:')
  })
})
