import type { ToolCallContent } from '@agentclientprotocol/sdk'

import type { TodoEntry, TodoPriority, TodoStatus } from '../../types/chat'

const MAX_JSON_CHARS = 1_000_000
const MAX_TODOS = 200
const MAX_CONTENT_CHARS = 10_000

type TodoToolLike = {
  title?: string | null
  name?: string | null
  status?: string | null
  content?: ToolCallContent[] | null
  rawInput?: unknown
  rawOutput?: unknown
}

type ParsedTodoToolCall = {
  entries: TodoEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonString(value: string): unknown {
  let source = value.trim()
  if (!source || source.length > MAX_JSON_CHARS) return null

  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(source)
  if (fence) source = fence[1].trim()
  if (!source.startsWith('[') && !source.startsWith('{')) return null

  try {
    return JSON.parse(source) as unknown
  } catch {
    return null
  }
}

function normalizeStatus(value: unknown): TodoStatus {
  if (typeof value !== 'string') return 'pending'
  const status = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (
    [
      'in_progress',
      'inprogress',
      'doing',
      'running',
      'active',
      'started',
    ].includes(status)
  ) {
    return 'in_progress'
  }
  if (
    [
      'completed',
      'complete',
      'done',
      'finished',
      'success',
      'succeeded',
    ].includes(status)
  ) {
    return 'completed'
  }
  if (['cancelled', 'canceled', 'skipped', 'abandoned'].includes(status)) {
    return 'cancelled'
  }
  return 'pending'
}

function normalizePriority(value: unknown): TodoPriority {
  if (typeof value !== 'string') return 'medium'
  const priority = value.trim().toLowerCase()
  if (priority === 'high' || priority === 'urgent' || priority === 'critical') {
    return 'high'
  }
  if (priority === 'low' || priority === 'minor') return 'low'
  return 'medium'
}

function parseTodoItem(value: unknown): TodoEntry | null {
  if (typeof value === 'string') {
    const content = value.trim()
    if (!content) return null
    return {
      content: content.slice(0, MAX_CONTENT_CHARS),
      status: 'pending',
      priority: 'medium',
    }
  }
  if (!isRecord(value) || typeof value.content !== 'string') return null
  const content = value.content.trim()
  if (!content) return null
  return {
    content: content.slice(0, MAX_CONTENT_CHARS),
    status: normalizeStatus(value.status ?? value.state),
    priority: normalizePriority(value.priority),
  }
}

/** Normalizes the native ACP plan `entries` array. */
export function parseTodoEntries(value: unknown): TodoEntry[] | null {
  if (!Array.isArray(value)) return null
  const entries: TodoEntry[] = []
  for (const item of value.slice(0, MAX_TODOS)) {
    const entry = parseTodoItem(item)
    if (entry) entries.push(entry)
  }
  return entries.length > 0 || value.length === 0 ? entries : null
}

function parseTodoJson(value: string): TodoEntry[] | null {
  const parsed = parseJsonString(value)
  if (Array.isArray(parsed)) return parseTodoEntries(parsed)
  if (!isRecord(parsed) || !('todos' in parsed)) return null
  return parseTodoEntries(parsed.todos)
}

function parseKnownCollection(value: unknown): TodoEntry[] | null {
  if (Array.isArray(value)) return parseTodoEntries(value)
  return typeof value === 'string' ? parseTodoJson(value) : null
}

function todoLabelMatches(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  const compact = normalized.replace(/[^a-z]/g, '')
  return (
    /(^|[^a-z])todos?([^a-z]|$)/i.test(normalized) ||
    compact === 'todowrite' ||
    compact === 'writetodos' ||
    normalized.includes('待办') ||
    normalized.includes('任务清单')
  )
}

function jsonTextFromToolContent(content: ToolCallContent): string | null {
  if (content.type !== 'content') return null
  const block = content.content
  if (block.type === 'text') return block.text
  if (
    block.type === 'resource' &&
    'text' in block.resource &&
    typeof block.resource.text === 'string'
  ) {
    return block.resource.text
  }
  return null
}

function entriesFromToolContent(
  content: ToolCallContent[] | null | undefined,
): TodoEntry[] | null {
  for (const item of content ?? []) {
    const text = jsonTextFromToolContent(item)
    if (text === null) continue
    const entries = parseTodoJson(text)
    if (entries !== null) return entries
  }
  return null
}

/**
 * Recognizes only Todo sources observed in ACP/OpenCode traffic:
 * rawInput.todos, rawOutput.metadata.todos, and JSON in tool content. Generic
 * raw output objects are deliberately ignored because many unrelated tools
 * return arrays containing `content` and `status` fields.
 */
export function parseTodoToolCall(
  toolCall: TodoToolLike,
): ParsedTodoToolCall | null {
  const input = isRecord(toolCall.rawInput) ? toolCall.rawInput : null
  const output = isRecord(toolCall.rawOutput) ? toolCall.rawOutput : null
  const metadata = isRecord(output?.metadata) ? output.metadata : null
  const hasInputTodos = input !== null && 'todos' in input
  const hasMetadataTodos = metadata !== null && 'todos' in metadata

  if (hasMetadataTodos) {
    const entries = parseKnownCollection(metadata.todos)
    if (entries !== null) return { entries }
  }

  const hasCredibleIdentity =
    hasInputTodos ||
    hasMetadataTodos ||
    todoLabelMatches(toolCall.name) ||
    todoLabelMatches(toolCall.title)
  if (hasCredibleIdentity) {
    const entries = entriesFromToolContent(toolCall.content)
    if (entries !== null) return { entries }
  }

  if (hasInputTodos) {
    const entries = parseKnownCollection(input.todos)
    if (entries !== null) return { entries }
  }
  return null
}

export function shouldHideTodoToolCall(
  toolCall: TodoToolLike & { permission?: unknown },
): boolean {
  if (toolCall.permission != null || toolCall.status === 'failed') return false
  return parseTodoToolCall(toolCall) !== null
}
