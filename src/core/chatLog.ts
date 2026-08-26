import type { App, Vault } from 'obsidian'

import type { ChatSessionState } from '../types/chat'

import { getSubagentToolDetails } from './toolCallDetails'

export const DEFAULT_CHAT_LOG_FOLDER = 'YOLO'

const DEFAULT_CHAT_LOG_FILE = `${DEFAULT_CHAT_LOG_FOLDER}/untitled.md`
const FALLBACK_FILE_NAME = 'untitled'
const MAX_FILE_NAME_LENGTH = 80

const writeQueues = new WeakMap<Vault, Promise<void>>()

function slashPath(raw: string): string {
  return raw.trim().replace(/\\/g, '/')
}

/** 归一化库内相对路径；父级路径会回退到默认值。 */
export function normalizeChatLogPath(raw: string): string {
  const trimmed = slashPath(raw).replace(/^\/+|\/+$/g, '')
  if (!trimmed) return DEFAULT_CHAT_LOG_FILE
  const segments = trimmed
    .split('/')
    .filter((segment) => segment && segment !== '.')
  if (segments.some((segment) => segment === '..')) return DEFAULT_CHAT_LOG_FILE
  return segments.join('/')
}

/** 归一化保存对话记录的库内文件夹路径。 */
export function normalizeChatLogFolder(raw: string): string {
  const trimmed = slashPath(raw).replace(/^\/+|\/+$/g, '')
  if (!trimmed) return DEFAULT_CHAT_LOG_FOLDER
  const segments = trimmed
    .split('/')
    .filter((segment) => segment && segment !== '.')
  if (segments.some((segment) => segment === '..')) {
    return DEFAULT_CHAT_LOG_FOLDER
  }
  return segments.join('/')
}

/** 把对话标题转成跨平台安全的文件名。 */
export function sanitizeChatLogFileName(title: string): string {
  const withoutReserved = title.replace(/[\\/:*?"<>|]/g, ' ')
  let withoutControl = ''
  for (const char of withoutReserved) {
    withoutControl += char < ' ' ? ' ' : char
  }
  const cleaned = withoutControl
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, MAX_FILE_NAME_LENGTH)
    .trim()
  return cleaned || FALLBACK_FILE_NAME
}

/** 当天日期子文件夹名，格式 YYYY-MM-DD（本地时区）。 */
export function chatLogDateFolder(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 导出路径 = <文件夹>/<当天日期>/<对话标题>.md。 */
export function chatLogFilePath(
  folder: string,
  title: string,
  date: Date = new Date(),
): string {
  return `${normalizeChatLogFolder(folder)}/${chatLogDateFolder(date)}/${sanitizeChatLogFileName(title)}.md`
}

/**
 * 把时间线序列化为普通 Markdown 笔记。只保存可阅读的对话正文，不写入
 * session id、恢复标记或插件私有元数据。
 */
export function serializeConversation(state: ChatSessionState): string {
  const sections: string[] = []
  for (const entry of state.entries) {
    if (entry.kind === 'user') {
      const text = entry.text.trim()
      if (text) sections.push(`## User\n\n${text}`)
      continue
    }
    if (entry.kind === 'assistant') {
      const text = entry.text.trim()
      const reasoning = entry.reasoning.trim()
      if (!text && !reasoning) continue
      const parts: string[] = []
      if (text) parts.push(text)
      if (reasoning) parts.push(`### Reasoning\n\n${reasoning}`)
      sections.push(`## Assistant\n\n${parts.join('\n\n')}`)
      continue
    }
    const details = getSubagentToolDetails(entry.toolCall)
    if (!details) continue
    const output = details.output.trim()
    if (!output) continue
    const label = entry.toolCall.title.replace(/\s+/g, ' ').trim()
    sections.push(`### Subagent: ${label || 'task'}\n\n${output}`)
  }
  if (sections.length === 0) return ''

  const title = state.title.replace(/\s+/g, ' ').trim() || 'untitled'
  return `# ${title}\n\n${sections.join('\n\n')}\n`
}

async function ensureParentFolders(
  vault: Vault,
  filePath: string,
): Promise<void> {
  const segments = filePath.split('/')
  segments.pop()
  let current = ''
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment
    const existing = vault.getAbstractFileByPath(current)
    if (existing && !vault.getFolderByPath(current)) {
      throw new Error(`${current} exists but is not a folder`)
    }
    if (!existing) {
      try {
        await vault.createFolder(current)
      } catch (error) {
        if (!vault.getFolderByPath(current)) throw error
      }
    }
  }
}

function suffixedPath(preferredPath: string, index: number): string {
  if (index === 1) return preferredPath
  const extensionIndex = preferredPath.toLowerCase().endsWith('.md')
    ? preferredPath.length - 3
    : preferredPath.length
  return `${preferredPath.slice(0, extensionIndex)} (${index})${preferredPath.slice(extensionIndex)}`
}

async function createUniqueConversationLog(
  vault: Vault,
  preferredPath: string,
  content: string,
): Promise<string> {
  await ensureParentFolders(vault, preferredPath)
  for (let index = 1; ; index += 1) {
    const candidate = suffixedPath(preferredPath, index)
    if (vault.getAbstractFileByPath(candidate)) continue
    try {
      await vault.create(candidate, content)
      return candidate
    } catch (error) {
      // Another writer may have claimed this name after the lookup. Advance to
      // the next suffix only when the candidate now exists.
      if (!vault.getAbstractFileByPath(candidate)) throw error
    }
  }
}

/**
 * 将当前对话导出为一篇新笔记。重名时添加 `(2)`、`(3)` 等普通文件后缀；
 * 不覆盖既有笔记，也不维护会话到文件的映射。
 */
export async function saveConversationLog(
  app: App,
  folder: string,
  state: ChatSessionState,
  date: Date = new Date(),
): Promise<string | null> {
  const content = serializeConversation(state)
  if (!content) return null

  const vault = app.vault
  const preferredPath = normalizeChatLogPath(
    chatLogFilePath(folder, state.title, date),
  )
  const previous = writeQueues.get(vault) ?? Promise.resolve()
  let writtenPath: string | null = null
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      writtenPath = await createUniqueConversationLog(
        vault,
        preferredPath,
        content,
      )
    })
  writeQueues.set(vault, current)
  try {
    await current
    if (!writtenPath) throw new Error('Conversation export produced no file')
    return writtenPath
  } finally {
    if (writeQueues.get(vault) === current) writeQueues.delete(vault)
  }
}
