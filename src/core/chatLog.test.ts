import type { App } from 'obsidian'

import type { ChatSessionState, TimelineEntry } from '../types/chat'

import {
  DEFAULT_CHAT_LOG_FOLDER,
  buildRestoreBlocks,
  chatLogDateFolder,
  chatLogFilePath,
  extractSessionId,
  listConversationLogs,
  mergeConversationDocuments,
  normalizeChatLogFolder,
  normalizeChatLogPath,
  sanitizeChatLogFileName,
  saveConversationLog,
  serializeConversation,
  shortSessionId,
  splitConversationDocument,
  stripConversationSegment,
  wrapConversationSegment,
  writeConversationLog,
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

describe('normalizeChatLogPath', () => {
  it('falls back to the default for blank input', () => {
    expect(normalizeChatLogPath('')).toBe('YOLO/untitled.md')
    expect(normalizeChatLogPath('   ')).toBe('YOLO/untitled.md')
    expect(normalizeChatLogPath('///')).toBe('YOLO/untitled.md')
  })

  it('strips surrounding slashes and collapses dot segments', () => {
    expect(normalizeChatLogPath('/notes/log.md/')).toBe('notes/log.md')
    expect(normalizeChatLogPath('notes/./log.md')).toBe('notes/log.md')
    expect(normalizeChatLogPath('notes//log.md')).toBe('notes/log.md')
  })

  it('rejects paths that escape the vault', () => {
    expect(normalizeChatLogPath('../outside.md')).toBe('YOLO/untitled.md')
    expect(normalizeChatLogPath('notes/../../outside.md')).toBe(
      'YOLO/untitled.md',
    )
  })
})

describe('normalizeChatLogFolder', () => {
  it('falls back to YOLO for blank or escaping input', () => {
    expect(normalizeChatLogFolder('')).toBe(DEFAULT_CHAT_LOG_FOLDER)
    expect(normalizeChatLogFolder('  ')).toBe(DEFAULT_CHAT_LOG_FOLDER)
    expect(normalizeChatLogFolder('../outside')).toBe(DEFAULT_CHAT_LOG_FOLDER)
  })

  it('keeps nested folders and strips slashes', () => {
    expect(normalizeChatLogFolder('/AI/logs/')).toBe('AI/logs')
  })
})

describe('sanitizeChatLogFileName', () => {
  it('replaces reserved characters and collapses whitespace', () => {
    expect(sanitizeChatLogFileName('a/b:c*d?e"f<g>h|i')).toBe(
      'a b c d e f g h i',
    )
    expect(sanitizeChatLogFileName('  多个   空格  ')).toBe('多个 空格')
    expect(sanitizeChatLogFileName('a\tb\nc')).toBe('a b c')
  })

  it('trims leading and trailing dots', () => {
    expect(sanitizeChatLogFileName('..秘密.')).toBe('秘密')
  })

  it('truncates long titles and falls back to untitled', () => {
    expect(sanitizeChatLogFileName('长'.repeat(200))).toHaveLength(80)
    expect(sanitizeChatLogFileName('')).toBe('untitled')
    expect(sanitizeChatLogFileName('  /:  ')).toBe('untitled')
  })
})

describe('chatLogDateFolder', () => {
  it('formats local dates as YYYY-MM-DD with zero padding', () => {
    expect(chatLogDateFolder(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(chatLogDateFolder(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('chatLogFilePath', () => {
  const day = new Date(2026, 7, 10)

  it('builds folder/date/title.md paths', () => {
    expect(chatLogFilePath('YOLO', '整理笔记', day)).toBe(
      'YOLO/2026-08-10/整理笔记.md',
    )
    expect(chatLogFilePath('AI/logs', 'a/b', day)).toBe(
      'AI/logs/2026-08-10/a b.md',
    )
    expect(chatLogFilePath('', '', day)).toBe('YOLO/2026-08-10/untitled.md')
  })
})

describe('serializeConversation', () => {
  it('returns an empty string when there is nothing to save', () => {
    expect(serializeConversation(makeState([]))).toBe('')
    expect(serializeConversation(makeState([toolEntry()]))).toBe('')
    expect(
      serializeConversation(makeState([userEntry('   '), assistantEntry('')])),
    ).toBe('')
  })

  it('serializes user/assistant text with reasoning, skipping plain tool calls', () => {
    const markdown = serializeConversation(
      makeState([
        userEntry('帮我整理这篇笔记'),
        assistantEntry('好的，已整理完成。', '先读了标题再决定结构'),
        toolEntry(),
        userEntry('再加一个标签'),
        assistantEntry('已添加。'),
      ]),
    )
    expect(markdown).toContain('Auto-generated by OpenYOLO')
    expect(markdown).toContain('<!-- openyolo-session: session-1 -->')
    expect(markdown).toContain('- Session: 测试会话')
    expect(markdown).toContain('## User\n\n帮我整理这篇笔记')
    expect(markdown).toContain(
      '## Assistant\n\n好的，已整理完成。\n\n### Reasoning\n\n先读了标题再决定结构',
    )
    expect(markdown).toContain('## User\n\n再加一个标签')
    expect(markdown).not.toContain('Read')
    expect(markdown.indexOf('帮我整理这篇笔记')).toBeLessThan(
      markdown.indexOf('好的，已整理完成。'),
    )
    expect(markdown.endsWith('\n')).toBe(true)
  })

  it('nests subagent output as a subsection and skips its envelope noise', () => {
    const markdown = serializeConversation(
      makeState([
        userEntry('调研一下笔记结构'),
        assistantEntry('我先派一个子 Agent 看看。'),
        subagentEntry('调研笔记结构', '库里使用 PARA 结构，共 38 篇笔记。'),
        assistantEntry('调研结果如下。'),
      ]),
    )
    expect(markdown).toContain(
      '### Subagent: 调研笔记结构\n\n库里使用 PARA 结构，共 38 篇笔记。',
    )
    expect(markdown).not.toContain('<task')
    expect(markdown).not.toContain('task_result')
    expect(markdown.indexOf('我先派一个子 Agent 看看。')).toBeLessThan(
      markdown.indexOf('### Subagent: 调研笔记结构'),
    )
    expect(markdown.indexOf('### Subagent: 调研笔记结构')).toBeLessThan(
      markdown.indexOf('调研结果如下。'),
    )
  })

  it('uses the session id override for the marker and omits it without any id', () => {
    const withOverride = serializeConversation(
      makeState([userEntry('你好')]),
      'ses_original',
    )
    expect(withOverride).toContain('<!-- openyolo-session: ses_original -->')
    expect(withOverride).not.toContain('session-1')

    const withoutId = serializeConversation({
      ...makeState([userEntry('你好')]),
      sessionId: null,
    })
    expect(withoutId).not.toContain('openyolo-session:')
  })

  it('keeps assistant entries that only have reasoning', () => {
    const markdown = serializeConversation(
      makeState([userEntry('问题'), assistantEntry('', '只有思考没有正文')]),
    )
    expect(markdown).toContain(
      '## Assistant\n\n### Reasoning\n\n只有思考没有正文',
    )
  })

  it('skips subagent calls with empty output and collapses multi-line titles', () => {
    const emptyOutput = subagentEntry('空输出任务', '')
    const raw = emptyOutput as { toolCall: { rawOutput: { output: string } } }
    raw.toolCall.rawOutput.output =
      '<task id="ses_child" state="completed"><task_result>   </task_result></task>'
    const titled = subagentEntry('多行\n标题\t混排', '输出内容')
    const markdown = serializeConversation(
      makeState([userEntry('任务'), emptyOutput, titled]),
    )
    expect(markdown).not.toContain('空输出任务')
    expect(markdown).toContain('### Subagent: 多行 标题 混排\n\n输出内容')
  })

  it('skips tools that merely carry a metadata session id', () => {
    const entry = toolEntry()
    ;(entry as { toolCall: { rawOutput?: unknown } }).toolCall.rawOutput = {
      metadata: { sessionId: 'ses_other' },
      output: '普通工具输出',
    }
    expect(
      serializeConversation(makeState([userEntry('问'), entry])),
    ).not.toContain('普通工具输出')
  })

  it('sanitizes multi-line titles in the header', () => {
    const state = {
      ...makeState([userEntry('你好')]),
      title: '第一行\n第二行',
    }
    const markdown = serializeConversation(state)
    expect(markdown).toContain('- Session: 第一行 第二行')
    expect(markdown).not.toContain('\n第二行\n')
  })
})

describe('extractSessionId', () => {
  it('parses the session marker and tolerates its absence', () => {
    expect(extractSessionId('a\n<!-- openyolo-session: ses_abc -->\nb')).toBe(
      'ses_abc',
    )
    expect(extractSessionId('no marker here')).toBeNull()
    expect(extractSessionId('<!-- openyolo-session:   -->')).toBeNull()
  })
})

describe('splitConversationDocument', () => {
  it('splits header and body at the first section heading', () => {
    const doc = '<!-- meta -->\n\n# Title\n\n## User\n\n你好\n'
    const parts = splitConversationDocument(doc)
    expect(parts.header).toBe('<!-- meta -->\n\n# Title')
    expect(parts.body).toBe('## User\n\n你好')
  })

  it('treats a leading segment marker as the start of the body', () => {
    const doc =
      '头部\n\n<!-- openyolo-segment: s1 -->\n\n## User\n\n你好\n\n<!-- /openyolo-segment: s1 -->\n'
    const parts = splitConversationDocument(doc)
    expect(parts.header).toBe('头部')
    expect(parts.body.startsWith('<!-- openyolo-segment: s1 -->')).toBe(true)
  })

  it('treats a document without sections as header-only', () => {
    expect(splitConversationDocument('只有头部')).toEqual({
      header: '只有头部',
      body: '',
    })
  })
})

describe('mergeConversationDocuments', () => {
  const previous =
    '<!-- openyolo-session: s1 -->\n\n# OpenYOLO conversation history\n\n## User\n\n旧问题\n\n## Assistant\n\n旧回答\n'

  it('keeps the new header and appends the old body before the new segment', () => {
    const next =
      '<!-- openyolo-session: s1 -->\n\n# OpenYOLO conversation history\n\n- Updated: now\n\n## User\n\n新问题\n'
    const merged = mergeConversationDocuments(previous, next, 's2')
    expect(merged).toContain('- Updated: now')
    expect(merged).toContain('## User\n\n旧问题')
    expect(merged).toContain('<!-- openyolo-segment: s2 -->')
    expect(merged).toContain('<!-- /openyolo-segment: s2 -->')
    expect(merged.indexOf('旧回答')).toBeLessThan(merged.indexOf('新问题'))
    expect(merged.match(/# OpenYOLO conversation history/g)).toHaveLength(1)
    expect(merged.endsWith('\n')).toBe(true)
  })

  it('is idempotent: merging again replaces the old segment instead of duplicating it', () => {
    const next1 = '头\n\n## User\n\n恢复提示\n\n## Assistant\n\n第一句\n'
    const next2 =
      '头\n\n## User\n\n恢复提示\n\n## Assistant\n\n第一句\n\n## User\n\n第二句\n'
    const merged1 = mergeConversationDocuments(previous, next1, 's2')
    const merged2 = mergeConversationDocuments(merged1, next2, 's2')
    expect(merged2.match(/第一句/g)).toHaveLength(1)
    expect(merged2.match(/第二句/g)).toHaveLength(1)
    expect(merged2.match(/旧回答/g)).toHaveLength(1)
    expect(merged2.match(/<!-- openyolo-segment: s2 -->/g)).toHaveLength(1)
    expect(merged2.match(/<!-- \/openyolo-segment: s2 -->/g)).toHaveLength(1)
  })

  it('keeps segments of other sessions intact when replacing one', () => {
    const next1 = '头\n\n## User\n\n分支一\n'
    const next2 = '头\n\n## User\n\n分支二\n'
    const merged1 = mergeConversationDocuments(previous, next1, 's2')
    const merged2 = mergeConversationDocuments(merged1, next2, 's3')
    expect(merged2).toContain('分支一')
    expect(merged2).toContain('分支二')
    expect(merged2.indexOf('分支一')).toBeLessThan(merged2.indexOf('分支二'))
  })
})

describe('shortSessionId', () => {
  it('keeps the last 8 alphanumeric characters', () => {
    expect(shortSessionId('ses_0153776c3ffe5GKDxm1nEVHnZO')).toBe(
      'xm1nEVHnZO'.slice(-8),
    )
    expect(shortSessionId('abc')).toBe('abc')
  })
})

describe('conversation segments', () => {
  it('returns the document unchanged when the segment is absent', () => {
    const doc = '## User\n\n你好'
    expect(stripConversationSegment(doc, 'ses_x')).toBe(doc)
  })

  it('strips only the matching segment and keeps siblings intact', () => {
    const doc = [
      '## User',
      '',
      '原始内容',
      '',
      wrapConversationSegment('ses_a', '## User\n\n分支A'),
      '',
      wrapConversationSegment('ses_b', '## User\n\n分支B'),
    ].join('\n')
    const stripped = stripConversationSegment(doc, 'ses_a')
    expect(stripped).toContain('原始内容')
    expect(stripped).not.toContain('分支A')
    expect(stripped).toContain('分支B')
    expect(stripped).not.toContain('openyolo-segment: ses_a')
  })

  it('splits and strips documents with CRLF line endings', () => {
    const doc =
      '头部\r\n\r\n<!-- openyolo-segment: s1 -->\r\n\r\n## User\r\n\r\n你好\r\n\r\n<!-- /openyolo-segment: s1 -->\r\n'
    const parts = splitConversationDocument(doc)
    expect(parts.header).toBe('头部')
    expect(stripConversationSegment(parts.body, 's1')).toBe('')
  })
})

type FakeFile = { path: string }

type FakeVault = {
  files: Map<string, string>
  folders: Set<string>
  getFileByPath: (path: string) => FakeFile | null
  getAbstractFileByPath: (path: string) => FakeFile | null
  process: (file: FakeFile, fn: (data: string) => string) => Promise<string>
  create: (path: string, data: string) => Promise<FakeFile>
  createFolder: (path: string) => Promise<FakeFile>
  adapter: {
    read: (path: string) => Promise<string>
    list: (path: string) => Promise<{ files: string[]; folders: string[] }>
    stat: (path: string) => Promise<{
      type: string
      ctime: number
      mtime: number
      size: number
    } | null>
  }
}

function makeVault(): FakeVault {
  const files = new Map<string, string>()
  const folders = new Set<string>()
  return {
    files,
    folders,
    getFileByPath: (path: string) => (files.has(path) ? { path } : null),
    getAbstractFileByPath: (path: string) =>
      files.has(path) || folders.has(path) ? { path } : null,
    process: (file: FakeFile, fn: (data: string) => string) => {
      files.set(file.path, fn(files.get(file.path) ?? ''))
      return Promise.resolve('')
    },
    create: (path: string, data: string) => {
      if (files.has(path)) throw new Error('already exists')
      files.set(path, data)
      return Promise.resolve({ path })
    },
    createFolder: (path: string) => {
      folders.add(path)
      return Promise.resolve({ path })
    },
    adapter: {
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
}

function asApp(vault: object): App {
  return { vault } as unknown as App
}

describe('saveConversationLog', () => {
  const day = new Date(2026, 7, 10)

  it('returns null when there is nothing to save', async () => {
    const vault = makeVault()
    await expect(
      saveConversationLog(asApp(vault), 'YOLO', makeState([]), day),
    ).resolves.toBeNull()
    expect(vault.files.size).toBe(0)
  })

  it('writes a new file directly when the state has no session id', async () => {
    const vault = makeVault()
    const state = { ...makeState([userEntry('你好')]), sessionId: null }
    const path = await saveConversationLog(asApp(vault), 'YOLO', state, day)
    expect(path).toBe('YOLO/2026-08-10/测试会话.md')
    expect(vault.files.get(path!)).not.toContain('openyolo-session:')
  })

  it('writes a new file under the date folder named by title', async () => {
    const vault = makeVault()
    const path = await saveConversationLog(
      asApp(vault),
      'YOLO',
      makeState([userEntry('你好'), assistantEntry('你好！')]),
      day,
    )
    expect(path).toBe('YOLO/2026-08-10/测试会话.md')
    expect(vault.files.get(path!)).toContain(
      '<!-- openyolo-session: session-1 -->',
    )
  })

  it('overwrites the existing file matched by session id, even across dates and renamed titles', async () => {
    const vault = makeVault()
    const first = await saveConversationLog(
      asApp(vault),
      'YOLO',
      makeState([userEntry('第一条')]),
      new Date(2026, 7, 9),
    )
    expect(first).toBe('YOLO/2026-08-09/测试会话.md')

    const renamed = {
      ...makeState([userEntry('第一条'), assistantEntry('更新')]),
      title: '新标题',
    }
    const second = await saveConversationLog(asApp(vault), 'YOLO', renamed, day)
    expect(second).toBe(first)
    expect(vault.files.get(first!)).toContain('更新')
    expect(vault.files.get(first!)).toContain('- Session: 新标题')
    expect(vault.files.has('YOLO/2026-08-10/新标题.md')).toBe(false)
  })

  it('appends the session id suffix when the title path is taken by another session', async () => {
    const vault = makeVault()
    await saveConversationLog(
      asApp(vault),
      'YOLO',
      makeState([userEntry('会话一')]),
      day,
    )
    const other = {
      ...makeState([userEntry('会话二')]),
      sessionId: 'session-2',
    }
    const path = await saveConversationLog(asApp(vault), 'YOLO', other, day)
    expect(path).toBe('YOLO/2026-08-10/测试会话-session2.md')
    expect(vault.files.get('YOLO/2026-08-10/测试会话.md')).toContain('会话一')
    expect(vault.files.get(path!)).toContain('会话二')
  })
})

describe('writeConversationLog', () => {
  it('creates parent folders and writes a new file', async () => {
    const vault = makeVault()
    await writeConversationLog(asApp(vault), 'notes/ai/log.md', '内容')
    expect(vault.files.get('notes/ai/log.md')).toBe('内容')
    expect(vault.folders.has('notes')).toBe(true)
    expect(vault.folders.has('notes/ai')).toBe(true)
  })

  it('overwrites an existing file in full', async () => {
    const vault = makeVault()
    await writeConversationLog(asApp(vault), 'log.md', '旧内容')
    await writeConversationLog(asApp(vault), 'log.md', '新内容')
    expect(vault.files.get('log.md')).toBe('新内容')
  })

  it('rejects when the path is occupied by a folder', async () => {
    const vault = makeVault()
    vault.folders.add('log.md')
    await expect(
      writeConversationLog(asApp(vault), 'log.md', '内容'),
    ).rejects.toThrow('not a file')
  })
})

describe('listConversationLogs', () => {
  function appWithAdapter(adapter: {
    list: (path: string) => Promise<{ files: string[]; folders: string[] }>
    stat: (path: string) => Promise<{
      type: string
      ctime: number
      mtime: number
      size: number
    } | null>
  }): App {
    return { vault: { adapter } } as unknown as App
  }

  it('returns markdown files from the root and date subfolders, newest first', async () => {
    const app = appWithAdapter({
      list: (path) => {
        if (path === 'YOLO') {
          return Promise.resolve({
            files: ['YOLO/loose.md', 'YOLO/skip.txt'],
            folders: ['YOLO/2026-08-09', 'YOLO/2026-08-10'],
          })
        }
        if (path === 'YOLO/2026-08-09') {
          return Promise.resolve({
            files: ['YOLO/2026-08-09/old.md'],
            folders: [],
          })
        }
        if (path === 'YOLO/2026-08-10') {
          return Promise.resolve({
            files: ['YOLO/2026-08-10/new.md'],
            folders: [],
          })
        }
        return Promise.reject(new Error('missing'))
      },
      stat: (path) =>
        Promise.resolve({
          type: 'file',
          ctime: 1,
          mtime: path.includes('new') ? 30 : path.includes('loose') ? 20 : 10,
          size: 1,
        }),
    })
    await expect(listConversationLogs(app, 'YOLO')).resolves.toEqual([
      { path: 'YOLO/2026-08-10/new.md', name: 'new', mtime: 30 },
      { path: 'YOLO/loose.md', name: 'loose', mtime: 20 },
      { path: 'YOLO/2026-08-09/old.md', name: 'old', mtime: 10 },
    ])
  })

  it('returns an empty list when the folder does not exist', async () => {
    const app = appWithAdapter({
      list: () => Promise.reject(new Error('missing')),
      stat: () => Promise.resolve(null),
    })
    await expect(listConversationLogs(app, 'YOLO')).resolves.toEqual([])
  })

  it('filters non-file entries and tolerates failing subfolders', async () => {
    const app = appWithAdapter({
      list: (path) => {
        if (path === 'YOLO') {
          return Promise.resolve({
            files: ['YOLO/note.md', 'YOLO/weird.md'],
            folders: ['YOLO/broken'],
          })
        }
        return Promise.reject(new Error('cannot list'))
      },
      stat: (path) =>
        Promise.resolve(
          path === 'YOLO/note.md'
            ? { type: 'file', ctime: 1, mtime: 5, size: 1 }
            : { type: 'folder', ctime: 1, mtime: 9, size: 0 },
        ),
    })
    await expect(listConversationLogs(app, 'YOLO')).resolves.toEqual([
      { path: 'YOLO/note.md', name: 'note', mtime: 5 },
    ])
  })
})

describe('buildRestoreBlocks', () => {
  it('builds a text block plus an embedded text resource', () => {
    const blocks = buildRestoreBlocks(
      '恢复上下文',
      '笔记内容',
      'openyolo/log.md',
      '/vault',
    )
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ type: 'text', text: '恢复上下文' })
    const resource = blocks[1]
    expect(resource.type).toBe('resource')
    if (resource.type !== 'resource') return
    expect('text' in resource.resource && resource.resource.text).toBe(
      '笔记内容',
    )
    expect(resource.resource.mimeType).toBe('text/plain')
    expect(resource.resource.uri.startsWith('file://')).toBe(true)
    expect(resource.resource.uri).toContain('/vault/openyolo/log.md')
  })
})
