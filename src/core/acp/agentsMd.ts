import type { App, Vault } from 'obsidian'

export const AGENTS_MD_FILE = 'AGENTS.md'
export const MANAGED_BLOCK_START = '<!-- openyolo:start -->'
export const MANAGED_BLOCK_END = '<!-- openyolo:end -->'

// 旧版 yolo-lite 标记：重命名后仍需识别并迁移为新标记
const LEGACY_BLOCK_START = '<!-- yolo-lite:start -->'
const LEGACY_BLOCK_END = '<!-- yolo-lite:end -->'

type MarkerFamily = {
  start: string
  end: string
}

type Span = {
  start: number
  end: number
}

const MARKER_FAMILIES: readonly MarkerFamily[] = [
  { start: MANAGED_BLOCK_START, end: MANAGED_BLOCK_END },
  { start: LEGACY_BLOCK_START, end: LEGACY_BLOCK_END },
]

const syncQueues = new WeakMap<Vault, Promise<void>>()

export type PromptLanguage = 'en' | 'zh'

export const DEFAULT_SYSTEM_PROMPT_ZH = `你是 Obsidian 笔记库中的 AI 笔记助手。你的主要职责是帮助用户查阅资料、整理与修改笔记，而不是完成软件工程任务。

工作方式：
- 默认使用中文回答（除非用户用其他语言提问）。
- 当前工作目录就是用户的 Obsidian 笔记库根目录，库中的 .md 文件即用户的笔记。
- 修改笔记时尽量做小范围编辑，保留原文的格式、frontmatter、标签与双链，不要无故重写整篇笔记。
- 引用或提及笔记时使用 Obsidian 双链格式 [[笔记名]]。
- 新建笔记使用规范的 Markdown 与 Obsidian 语法（callout、wiki 链接、标签），标题简洁清晰。
- 查阅资料时说明信息来源；不确定或无法核实的内容要明确标注，不要编造。
- 优先使用文件读写工具完成操作，终端命令仅在确有必要时使用。
- 回答保持简洁，直接给出结论与建议的修改，需要用户确认的大改动先说明方案再动手。`

export const DEFAULT_SYSTEM_PROMPT_EN = `You are an AI note assistant working inside an Obsidian vault. Your primary responsibility is to help the user find information, organize notes, and edit notes rather than perform software engineering tasks.

Working guidelines:
- Respond in English by default unless the user asks in another language.
- The current working directory is the root of the user's Obsidian vault, and the .md files inside it are the user's notes.
- When editing notes, prefer small, targeted changes. Preserve the original formatting, frontmatter, tags, and wikilinks, and do not rewrite an entire note without a good reason.
- Refer to notes using Obsidian wikilinks in the form [[Note name]].
- When creating notes, use standard Markdown and Obsidian syntax, including callouts, wikilinks, and tags, and keep titles concise and clear.
- When researching, identify the sources. Clearly state when information is uncertain or cannot be verified, and do not fabricate details.
- Prefer file reading and writing tools. Use terminal commands only when they are genuinely necessary.
- Keep answers concise and provide conclusions and suggested edits directly. Explain the plan and ask for confirmation before making substantial changes.`

const DEFAULT_SYSTEM_PROMPTS: Record<PromptLanguage, string> = {
  en: DEFAULT_SYSTEM_PROMPT_EN,
  zh: DEFAULT_SYSTEM_PROMPT_ZH,
}

export function getDefaultSystemPrompt(language: PromptLanguage): string {
  return DEFAULT_SYSTEM_PROMPTS[language]
}

function lineEndingFor(document: string): '\n' | '\r\n' {
  return document.includes('\r\n') ? '\r\n' : '\n'
}

function markerAtLine(
  line: string,
): { family: number; kind: 'start' | 'end' } | undefined {
  for (let family = 0; family < MARKER_FAMILIES.length; family += 1) {
    const markers = MARKER_FAMILIES[family]
    if (!markers) continue
    if (line === markers.start) return { family, kind: 'start' }
    if (line === markers.end) return { family, kind: 'end' }
  }
  return undefined
}

/**
 * Finds complete, same-family marker pairs. Marker text is only structural when
 * it occupies a whole line, so prose that merely mentions a marker is safe.
 * Unmatched or cross-family markers are user content and are never consumed.
 */
function managedSpans(document: string): Span[] {
  const stacks = MARKER_FAMILIES.map(() => [] as number[])
  const spans: Span[] = []
  let offset = 0

  while (offset < document.length) {
    const newline = document.indexOf('\n', offset)
    const rawLineEnd = newline === -1 ? document.length : newline
    const lineEnd =
      rawLineEnd > offset && document[rawLineEnd - 1] === '\r'
        ? rawLineEnd - 1
        : rawLineEnd
    const marker = markerAtLine(document.slice(offset, lineEnd))

    if (marker?.kind === 'start') {
      stacks[marker.family]?.push(offset)
    } else if (marker) {
      const start = stacks[marker.family]?.pop()
      if (start !== undefined) spans.push({ start, end: lineEnd })
    }

    if (newline === -1) break
    offset = newline + 1
  }

  spans.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: Span[] = []
  for (const span of spans) {
    const previous = merged[merged.length - 1]
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

function sanitizeBlockContent(blockContent: string): string {
  let safe = blockContent.trim()
  for (const family of MARKER_FAMILIES) {
    for (const marker of [family.start, family.end]) {
      safe = safe.split(marker).join(marker.replace('<!--', '&lt;!--'))
    }
  }
  return safe
}

function renderManagedBlock(blockContent: string, eol: string): string {
  return [
    MANAGED_BLOCK_START,
    sanitizeBlockContent(blockContent),
    MANAGED_BLOCK_END,
  ].join(eol)
}

function replaceSpans(
  document: string,
  spans: readonly Span[],
  replacement: string,
): string {
  let result = ''
  let cursor = 0
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]
    if (!span) continue
    result += document.slice(cursor, span.start)
    if (index === 0) result += replacement
    cursor = span.end
  }
  return result + document.slice(cursor)
}

export function hasManagedBlock(existing: string): boolean {
  return managedSpans(existing).length > 0
}

/**
 * Upserts one canonical managed block while preserving every byte outside any
 * complete managed/legacy block. Additional complete blocks are removed.
 */
export function upsertManagedBlock(
  existing: string,
  blockContent: string,
): string {
  const eol = lineEndingFor(existing)
  const block = renderManagedBlock(blockContent, eol)
  const spans = managedSpans(existing)
  if (spans.length > 0) return replaceSpans(existing, spans, block)
  if (!existing) return `${block}${eol}`

  const separator = existing.endsWith(`${eol}${eol}`)
    ? ''
    : existing.endsWith(eol)
      ? eol
      : `${eol}${eol}`
  return `${existing}${separator}${block}${eol}`
}

/** Removes every complete managed/legacy block without touching outside bytes. */
export function removeManagedBlock(existing: string): string {
  const spans = managedSpans(existing)
  return spans.length > 0 ? replaceSpans(existing, spans, '') : existing
}

function updateAgentsMdDocument(
  current: string,
  prompt: string,
  enabled: boolean,
): string {
  return enabled
    ? upsertManagedBlock(current, prompt)
    : removeManagedBlock(current)
}

async function processAgentsMd(
  vault: Vault,
  prompt: string,
  enabled: boolean,
): Promise<void> {
  const update = (current: string) =>
    updateAgentsMdDocument(current, prompt, enabled)
  const file = vault.getFileByPath(AGENTS_MD_FILE)
  if (file) {
    await vault.process(file, update)
    return
  }

  const occupiedPath = vault.getAbstractFileByPath(AGENTS_MD_FILE)
  if (occupiedPath) {
    throw new Error(`${AGENTS_MD_FILE} exists but is not a file`)
  }

  const initial = update('')
  if (!initial) return
  try {
    await vault.create(AGENTS_MD_FILE, initial)
  } catch (error) {
    // Another writer may have created the file after our lookup. Re-enter via
    // Vault.process so its latest bytes participate in the atomic transform.
    const racedFile = vault.getFileByPath(AGENTS_MD_FILE)
    if (!racedFile) throw error
    await vault.process(racedFile, update)
  }
}

/**
 * Serializes this plugin's writes per vault and uses Vault.process for existing
 * files, preventing read-modify-write races with other Obsidian writers.
 */
export function syncAgentsMd(
  app: App,
  prompt: string,
  enabled: boolean,
): Promise<void> {
  const vault = app.vault
  const previous = syncQueues.get(vault) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(() => processAgentsMd(vault, prompt, enabled))
  syncQueues.set(vault, current)
  return current.finally(() => {
    if (syncQueues.get(vault) === current) syncQueues.delete(vault)
  })
}
