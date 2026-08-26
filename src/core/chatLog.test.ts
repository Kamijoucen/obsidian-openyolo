import type { App } from 'obsidian'

import type { ChatSessionState, TimelineEntry } from '../types/chat'

import {
  DEFAULT_CHAT_LOG_FOLDER,
  chatLogDateFolder,
  chatLogFilePath,
  normalizeChatLogFolder,
  normalizeChatLogPath,
  sanitizeChatLogFileName,
  saveConversationLog,
  serializeConversation,
} from './chatLog'

function makeState(entries: TimelineEntry[]): ChatSessionState {
  return {
    sessionId: 'session-1',
    title: '测试会话',
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

function assistantEntry(text: string, reasoning = ''): TimelineEntry {
  return {
    kind: 'assistant',
    id: `a-${text}`,
    messageId: `m-${text}`,
    timestamp: 2,
    text,
    reasoning,
    blocks: [],
    streaming: false,
  }
}

function toolEntry(): TimelineEntry {
  return {
    kind: 'tool',
    id: 'tool-1',
    timestamp: 3,
    toolCall: {
      toolCallId: 'call-1',
      title: 'Read',
      kind: 'read',
      status: 'completed',
      content: [],
      locations: [],
      permission: null,
    },
  }
}

function subagentEntry(title: string, output: string): TimelineEntry {
  return {
    kind: 'tool',
    id: `tool-${title}`,
    timestamp: 4,
    toolCall: {
      toolCallId: `call-${title}`,
      title,
      kind: 'other',
      status: 'completed',
      content: [],
      locations: [],
      rawInput: {
        subagent_type: 'explore',
        description: title,
        prompt: '调研一下',
      },
      rawOutput: {
        metadata: { sessionId: 'ses_child' },
        output: `<task id="ses_child" state="completed"><task_result>${output}</task_result></task>`,
      },
      permission: null,
    },
  }
}

describe('chat log paths', () => {
  it('normalizes slash styles and rejects parent traversal', () => {
    expect(normalizeChatLogPath('')).toBe('YOLO/untitled.md')
    expect(normalizeChatLogPath('/notes/./log.md/')).toBe('notes/log.md')
    expect(normalizeChatLogPath('notes\\log.md')).toBe('notes/log.md')
    expect(normalizeChatLogPath('..\\outside.md')).toBe('YOLO/untitled.md')
    expect(normalizeChatLogPath('notes/../../outside.md')).toBe(
      'YOLO/untitled.md',
    )
  })

  it('normalizes export folders', () => {
    expect(normalizeChatLogFolder('')).toBe(DEFAULT_CHAT_LOG_FOLDER)
    expect(normalizeChatLogFolder('/AI\\logs/')).toBe('AI/logs')
    expect(normalizeChatLogFolder('..\\outside')).toBe(DEFAULT_CHAT_LOG_FOLDER)
  })

  it('sanitizes file names and builds dated paths', () => {
    expect(sanitizeChatLogFileName('a/b:c*d?e"f<g>h|i')).toBe(
      'a b c d e f g h i',
    )
    expect(sanitizeChatLogFileName('..秘密.')).toBe('秘密')
    expect(sanitizeChatLogFileName('  /:  ')).toBe('untitled')
    expect(sanitizeChatLogFileName('长'.repeat(200))).toHaveLength(80)

    const day = new Date(2026, 7, 10)
    expect(chatLogDateFolder(day)).toBe('2026-08-10')
    expect(chatLogFilePath('AI/logs', 'a/b', day)).toBe(
      'AI/logs/2026-08-10/a b.md',
    )
  })
})

describe('serializeConversation', () => {
  it('returns an empty string when there is no readable conversation', () => {
    expect(serializeConversation(makeState([]))).toBe('')
    expect(serializeConversation(makeState([toolEntry()]))).toBe('')
    expect(
      serializeConversation(makeState([userEntry('   '), assistantEntry('')])),
    ).toBe('')
  })

  it('exports a plain Markdown note without private metadata', () => {
    const markdown = serializeConversation(
      makeState([
        userEntry('问题'),
        assistantEntry('回答', '分析'),
        toolEntry(),
        subagentEntry('调研\n任务', '子任务结果'),
      ]),
    )

    expect(markdown).toBe(
      '# 测试会话\n\n## User\n\n问题\n\n## Assistant\n\n回答\n\n### Reasoning\n\n分析\n\n### Subagent: 调研 任务\n\n子任务结果\n',
    )
    expect(markdown).not.toContain('openyolo-session')
    expect(markdown).not.toContain('openyolo-segment')
    expect(markdown).not.toContain('session-1')
  })

  it('uses a readable fallback title and keeps reasoning-only replies', () => {
    const state = {
      ...makeState([assistantEntry('', '只有推理')]),
      title: '  ',
    }
    expect(serializeConversation(state)).toBe(
      '# untitled\n\n## Assistant\n\n### Reasoning\n\n只有推理\n',
    )
  })
})

type FakeFile = { path: string }

type FakeVault = {
  files: Map<string, string>
  folders: Set<string>
  getFileByPath: (path: string) => FakeFile | null
  getFolderByPath: (path: string) => FakeFile | null
  getAbstractFileByPath: (path: string) => FakeFile | null
  create: (path: string, data: string) => Promise<FakeFile>
  createFolder: (path: string) => Promise<FakeFile>
}

function makeVault(): FakeVault {
  const files = new Map<string, string>()
  const folders = new Set<string>()
  return {
    files,
    folders,
    getFileByPath: (path: string) => (files.has(path) ? { path } : null),
    getFolderByPath: (path: string) => (folders.has(path) ? { path } : null),
    getAbstractFileByPath: (path: string) =>
      files.has(path) || folders.has(path) ? { path } : null,
    create: (path: string, data: string) => {
      if (files.has(path) || folders.has(path)) {
        return Promise.reject(new Error('already exists'))
      }
      files.set(path, data)
      return Promise.resolve({ path })
    },
    createFolder: (path: string) => {
      if (files.has(path)) return Promise.reject(new Error('file exists'))
      folders.add(path)
      return Promise.resolve({ path })
    },
  }
}

function asApp(vault: object): App {
  return { vault } as unknown as App
}

describe('saveConversationLog', () => {
  const day = new Date(2026, 7, 10)

  it('returns null when there is nothing to export', async () => {
    const vault = makeVault()
    await expect(
      saveConversationLog(asApp(vault), 'YOLO', makeState([]), day),
    ).resolves.toBeNull()
    expect(vault.files.size).toBe(0)
  })

  it('creates a plain note and its parent folders', async () => {
    const vault = makeVault()
    const path = await saveConversationLog(
      asApp(vault),
      'YOLO',
      makeState([userEntry('你好'), assistantEntry('你好！')]),
      day,
    )

    expect(path).toBe('YOLO/2026-08-10/测试会话.md')
    expect(vault.folders).toEqual(new Set(['YOLO', 'YOLO/2026-08-10']))
    expect(vault.files.get(path!)).toBe(
      '# 测试会话\n\n## User\n\n你好\n\n## Assistant\n\n你好！\n',
    )
  })

  it('uses ordinary numeric suffixes and never overwrites existing notes', async () => {
    const vault = makeVault()
    vault.folders.add('YOLO')
    vault.folders.add('YOLO/2026-08-10')
    vault.files.set('YOLO/2026-08-10/测试会话.md', '用户原有内容')
    vault.files.set('YOLO/2026-08-10/测试会话 (2).md', '旧导出')

    const path = await saveConversationLog(
      asApp(vault),
      'YOLO',
      makeState([userEntry('新导出')]),
      day,
    )

    expect(path).toBe('YOLO/2026-08-10/测试会话 (3).md')
    expect(vault.files.get('YOLO/2026-08-10/测试会话.md')).toBe('用户原有内容')
    expect(vault.files.get(path!)).toContain('新导出')
  })

  it('serializes concurrent exports before choosing their file names', async () => {
    const vault = makeVault()
    const app = asApp(vault)
    const state = makeState([userEntry('内容')])

    const paths = await Promise.all([
      saveConversationLog(app, 'YOLO', state, day),
      saveConversationLog(app, 'YOLO', state, day),
      saveConversationLog(app, 'YOLO', state, day),
    ])

    expect(paths).toEqual([
      'YOLO/2026-08-10/测试会话.md',
      'YOLO/2026-08-10/测试会话 (2).md',
      'YOLO/2026-08-10/测试会话 (3).md',
    ])
    expect(vault.files.size).toBe(3)
  })

  it('rejects when a parent path is occupied by a file', async () => {
    const vault = makeVault()
    vault.files.set('YOLO', 'not a folder')
    await expect(
      saveConversationLog(
        asApp(vault),
        'YOLO',
        makeState([userEntry('内容')]),
        day,
      ),
    ).rejects.toThrow()
  })
})
