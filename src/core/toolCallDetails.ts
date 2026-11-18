import type { ToolCallContent } from '@agentclientprotocol/sdk/unstable'

import type { ToolCallState } from '../types/chat'

type UnknownRecord = Record<string, unknown>

export type SubagentToolDetails = {
  sessionId: string
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
  const agentType =
    nonEmptyString(input?.subagent_type) ?? nonEmptyString(input?.agent)
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
 * OpenCode 1 uses task envelopes and metadata.sessionId; OpenCode 2 returns
 * metadata.sessionID and status as soon as the background worker is launched.
 * A completed delegation tool is not evidence that the worker has finished.
 */
export function getSubagentToolDetails(
  toolCall: Pick<ToolCallState, 'rawInput' | 'rawOutput'>,
): SubagentToolDetails | null {
  const input = asRecord(toolCall.rawInput)
  const outputRecord = asRecord(toolCall.rawOutput)
  const metadata = asRecord(outputRecord?.metadata)
  const rawOutputText = nonEmptyString(outputRecord?.output) ?? ''
  const envelope = rawOutputText
    ? parseOpenCodeTaskEnvelope(rawOutputText)
    : null

  const metadataSessionId =
    nonEmptyString(metadata?.sessionID) ?? nonEmptyString(metadata?.sessionId)

  // sessionId is extension metadata and may also be used by unrelated tools.
  // Require a concrete task input as well as runtime session identity. Generic
  // metadata and input.task_id alone are not sufficient to identify a child.
  if (!hasOpenCodeTaskInput(input)) return null

  const sessionId = metadataSessionId ?? envelope?.sessionId
  if (!sessionId) return null

  return {
    sessionId,
    state: nonEmptyString(metadata?.status) ?? envelope?.state ?? null,
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
