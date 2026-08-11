import type { ToolCallContent } from '@agentclientprotocol/sdk'

import type { ToolCallState } from '../types/chat'

type UnknownRecord = Record<string, unknown>

type SubagentToolDetails = {
  state: string | null
  output: string
  rawOutputText: string
}

type TaskEnvelope = {
  sessionId: string
  state: string | null
  output: string
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as UnknownRecord
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function hasOpenCodeTaskInput(input: UnknownRecord | null): boolean {
  const agentType = nonEmptyString(input?.subagent_type)
  const description = nonEmptyString(input?.description)
  const prompt = nonEmptyString(input?.prompt)
  return Boolean(agentType && description && prompt)
}

function attribute(openingTag: string, name: string): string | null {
  const match = openingTag.match(
    new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`),
  )
  return nonEmptyString(match?.[1] ?? match?.[2])
}

/**
 * Parses the concrete task envelope emitted by OpenCode's task tool. This is
 * deliberately not a generic XML parser: arbitrary tool output remains plain
 * text and is never treated as a subagent result.
 */
export function parseOpenCodeTaskEnvelope(text: string): TaskEnvelope | null {
  const start = text.indexOf('<task ')
  if (start < 0) return null
  const openingEnd = text.indexOf('>', start + 6)
  if (openingEnd < 0 || openingEnd - start > 512) return null

  const openingTag = text.slice(start + 6, openingEnd)
  const sessionId = attribute(openingTag, 'id')
  if (!sessionId) return null

  const resultStart = text.indexOf('<task_result>', openingEnd + 1)
  const errorStart = text.indexOf('<task_error>', openingEnd + 1)
  const isError =
    errorStart >= 0 && (resultStart < 0 || errorStart < resultStart)
  const contentStart = isError ? errorStart : resultStart
  if (contentStart < 0) return null

  const openingContentTag = isError ? '<task_error>' : '<task_result>'
  const closingContentTag = isError ? '</task_error>' : '</task_result>'
  const outputStart = contentStart + openingContentTag.length
  const outputEnd = text.lastIndexOf(closingContentTag)
  if (outputEnd < outputStart) return null

  return {
    sessionId,
    state: attribute(openingTag, 'state'),
    output: text.slice(outputStart, outputEnd).trim(),
  }
}

/**
 * OpenCode exposes task identity under rawOutput.metadata.sessionId and in the
 * task output envelope. Both shapes are runtime-checked because ACP
 * intentionally types rawInput/rawOutput as unknown. Session identity is used
 * only to recognize the result; the UI renders it inline and does not navigate
 * to or maintain a child conversation.
 */
export function getSubagentToolDetails(
  toolCall: Pick<ToolCallState, 'rawInput' | 'rawOutput'>,
): SubagentToolDetails | null {
  const input = asRecord(toolCall.rawInput)
  const outputRecord = asRecord(toolCall.rawOutput)
  const metadata = asRecord(outputRecord?.metadata)
  const rawOutputText = nonEmptyString(outputRecord?.output)
  const envelope = rawOutputText
    ? parseOpenCodeTaskEnvelope(rawOutputText)
    : null

  const metadataSessionId = nonEmptyString(metadata?.sessionId)

  // sessionId is extension metadata and may also be used by unrelated tools.
  // Require both a concrete OpenCode task input and displayable output before
  // treating a tool result as a subagent result.
  if (!hasOpenCodeTaskInput(input) || !rawOutputText) return null

  const sessionId = metadataSessionId ?? envelope?.sessionId
  if (!sessionId) return null

  return {
    state: envelope?.state ?? null,
    output: envelope?.output ?? rawOutputText,
    rawOutputText,
  }
}

export function isSubagentRawOutputContent(
  content: ToolCallContent,
  details: SubagentToolDetails,
): boolean {
  return (
    content.type === 'content' &&
    content.content.type === 'text' &&
    content.content.text.trim() === details.rawOutputText
  )
}
