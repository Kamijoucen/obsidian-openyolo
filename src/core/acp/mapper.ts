import type {
  ContentBlock,
  PermissionOption,
  SessionConfigOption,
  SessionMode,
  SessionUpdate,
  StopReason,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'

import type {
  ChatAssistantEntry,
  ChatSessionState,
  ChatToolEntry,
  ChatUserEntry,
  ToolCallState,
} from '../../types/chat'

let entrySeq = 0
function nextEntryId(): string {
  entrySeq += 1
  return `e${Date.now().toString(36)}_${entrySeq}`
}

function textOfContent(content: ContentBlock): string {
  if (content.type === 'text') return content.text
  return ''
}

/**
 * opencode 会把附件（resource_link 文件）在提示词处理时展开为 user 消息里的
 * synthetic 文本（"Called the Read tool…"+文件内容），回放时通过
 * annotations.audience 标记（['assistant']=synthetic、['user']=ignored）。
 * 这类内容是给模型的上下文，不应显示在气泡里。
 */
function isSyntheticContent(content: ContentBlock): boolean {
  const audience = content.annotations?.audience
  return (
    Array.isArray(audience) &&
    audience.length === 1 &&
    (audience[0] === 'assistant' || audience[0] === 'user')
  )
}

export function createInitialSessionState(title: string): ChatSessionState {
  return {
    sessionId: null,
    title,
    status: 'idle',
    awaitingResponse: false,
    error: null,
    entries: [],
    plan: [],
    usage: null,
    mode: null,
    commands: [],
    configOptions: [],
    lastStopReason: null,
  }
}

export type SessionStateListener = (state: ChatSessionState) => void

export class SessionStateStore {
  private state: ChatSessionState
  private listeners = new Set<SessionStateListener>()
  private assistantEntryByMessageId = new Map<string, string>()
  private userEntryByMessageId = new Map<string, string>()
  private toolEntryByCallId = new Map<string, string>()

  constructor(title: string) {
    this.state = createInitialSessionState(title)
  }

  getState(): ChatSessionState {
    return this.state
  }

  subscribe(listener: SessionStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.state)
    }
  }

  setSessionId(sessionId: string) {
    this.state = { ...this.state, sessionId }
    this.emit()
  }

  resetForReplay(sessionId: string, title = this.state.title) {
    this.assistantEntryByMessageId.clear()
    this.userEntryByMessageId.clear()
    this.toolEntryByCallId.clear()
    this.state = {
      ...createInitialSessionState(title),
      sessionId,
      status: 'loading',
    }
    this.emit()
  }

  setStatus(status: ChatSessionState['status'], error: string | null = null) {
    this.state = {
      ...this.state,
      status,
      awaitingResponse:
        status === 'running' ? this.state.awaitingResponse : false,
      error,
    }
    this.emit()
  }

  setTitle(title: string) {
    if (!title) return
    this.state = { ...this.state, title }
    this.emit()
  }

  setModeCurrent(modeId: string) {
    const current = this.state.mode
    this.state = {
      ...this.state,
      mode: { current: modeId, available: current?.available ?? [] },
    }
    this.emit()
  }

  applyModes(current: string, available: SessionMode[]) {
    this.state = { ...this.state, mode: { current, available } }
    this.emit()
  }

  applyConfigOptions(configOptions: SessionConfigOption[]) {
    this.state = { ...this.state, configOptions }
    this.emit()
  }

  appendLocalUserMessage(text: string, blocks: ContentBlock[]) {
    const entry: ChatUserEntry = {
      kind: 'user',
      id: nextEntryId(),
      messageId: null,
      timestamp: Date.now(),
      text,
      blocks,
    }
    this.state = { ...this.state, entries: [...this.state.entries, entry] }
    this.emit()
  }

  markRunning() {
    this.state = {
      ...this.state,
      status: 'running',
      awaitingResponse: true,
      error: null,
    }
    this.emit()
  }

  markPreparing() {
    this.state = {
      ...this.state,
      status: 'preparing',
      awaitingResponse: false,
      error: null,
    }
    this.emit()
  }

  markCancelling() {
    this.state = { ...this.state, status: 'cancelling' }
    this.emit()
  }

  markTurnEnd(stopReason: StopReason | null) {
    const entries = this.state.entries.map((entry) =>
      entry.kind === 'assistant' && entry.streaming
        ? { ...entry, streaming: false }
        : entry,
    )
    this.state = {
      ...this.state,
      entries,
      status: 'idle',
      awaitingResponse: false,
      lastStopReason: stopReason,
    }
    this.emit()
  }

  applyUpdate(update: SessionUpdate) {
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        this.applyUserChunk(update.messageId ?? '', update.content)
        break
      case 'agent_message_chunk':
        this.markResponseStarted()
        this.applyAssistantChunk(update.messageId ?? '', update.content, false)
        break
      case 'agent_thought_chunk':
        this.markResponseStarted()
        this.applyAssistantChunk(update.messageId ?? '', update.content, true)
        break
      case 'tool_call':
        this.markResponseStarted()
        this.upsertToolCall({
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind,
          status: update.status,
          content: update.content,
          locations: update.locations,
          rawInput: update.rawInput,
          rawOutput: update.rawOutput,
        })
        break
      case 'tool_call_update':
        this.markResponseStarted()
        this.upsertToolCall(update)
        break
      case 'plan':
        this.markResponseStarted()
        this.state = { ...this.state, plan: update.entries }
        break
      case 'usage_update':
        this.state = {
          ...this.state,
          usage: {
            used: update.used,
            size: update.size,
            cost: update.cost,
          },
        }
        break
      case 'current_mode_update':
        this.setModeCurrent(update.currentModeId)
        return
      case 'available_commands_update':
        this.state = { ...this.state, commands: update.availableCommands }
        break
      case 'config_option_update':
        this.state = { ...this.state, configOptions: update.configOptions }
        break
      case 'session_info_update':
        if (update.title) {
          this.state = { ...this.state, title: update.title }
        }
        break
      default:
        return
    }
    this.emit()
  }

  private markResponseStarted() {
    if (!this.state.awaitingResponse) return
    this.state = { ...this.state, awaitingResponse: false }
  }

  setPendingPermission(toolCall: ToolCallUpdate, options: PermissionOption[]) {
    this.upsertToolCall({ ...toolCall, status: toolCall.status ?? 'pending' })
    this.replaceToolEntry(toolCall.toolCallId, (entry) => ({
      ...entry,
      toolCall: { ...entry.toolCall, permission: { options } },
    }))
    this.emit()
  }

  clearPendingPermission(toolCallId: string) {
    if (!this.hasPendingPermission(toolCallId)) return
    this.replaceToolEntry(toolCallId, (entry) => ({
      ...entry,
      toolCall: { ...entry.toolCall, permission: null },
    }))
    this.emit()
  }

  hasPendingPermission(toolCallId: string): boolean {
    return this.findToolEntry(toolCallId)?.toolCall.permission != null
  }

  private replaceToolEntry(
    toolCallId: string,
    updater: (entry: ChatToolEntry) => ChatToolEntry,
  ) {
    const id = this.toolEntryByCallId.get(toolCallId)
    if (!id) return
    this.state = {
      ...this.state,
      entries: this.state.entries.map((item) =>
        item.kind === 'tool' && item.id === id ? updater(item) : item,
      ),
    }
  }

  private applyUserChunk(messageId: string, content: ContentBlock) {
    if (isSyntheticContent(content)) return
    const existingId = this.userEntryByMessageId.get(messageId)
    if (existingId) {
      this.state = {
        ...this.state,
        entries: this.state.entries.map((item) =>
          item.kind === 'user' && item.id === existingId
            ? {
                ...item,
                text: item.text + textOfContent(content),
                blocks: [...item.blocks, content],
              }
            : item,
        ),
      }
      return
    }
    const entry: ChatUserEntry = {
      kind: 'user',
      id: nextEntryId(),
      messageId,
      timestamp: Date.now(),
      text: textOfContent(content),
      blocks: [content],
    }
    this.userEntryByMessageId.set(messageId, entry.id)
    this.state = { ...this.state, entries: [...this.state.entries, entry] }
  }

  private applyAssistantChunk(
    messageId: string,
    content: ContentBlock,
    isThought: boolean,
  ) {
    if (isSyntheticContent(content)) return
    const existingId = this.assistantEntryByMessageId.get(messageId)
    if (existingId) {
      this.state = {
        ...this.state,
        entries: this.state.entries.map((item) =>
          item.kind === 'assistant' && item.id === existingId
            ? {
                ...item,
                text: isThought
                  ? item.text
                  : item.text + textOfContent(content),
                reasoning: isThought
                  ? item.reasoning + textOfContent(content)
                  : item.reasoning,
              }
            : item,
        ),
      }
      return
    }
    const entry: ChatAssistantEntry = {
      kind: 'assistant',
      id: nextEntryId(),
      messageId,
      timestamp: Date.now(),
      text: isThought ? '' : textOfContent(content),
      reasoning: isThought ? textOfContent(content) : '',
      streaming: true,
    }
    this.assistantEntryByMessageId.set(messageId, entry.id)
    this.state = { ...this.state, entries: [...this.state.entries, entry] }
  }

  private upsertToolCall(update: ToolCallUpdate) {
    const existing = this.findToolEntry(update.toolCallId)
    if (existing) {
      this.replaceToolEntry(update.toolCallId, (entry) => {
        const prev = entry.toolCall
        return {
          ...entry,
          toolCall: {
            ...prev,
            title: update.title ?? prev.title,
            kind: update.kind ?? prev.kind,
            status: update.status ?? prev.status,
            content: update.content ?? prev.content,
            locations: update.locations ?? prev.locations,
            rawInput:
              update.rawInput !== undefined ? update.rawInput : prev.rawInput,
            rawOutput:
              update.rawOutput !== undefined
                ? update.rawOutput
                : prev.rawOutput,
          },
        }
      })
      return
    }
    const toolCall: ToolCallState = {
      toolCallId: update.toolCallId,
      title: update.title ?? '',
      kind: update.kind ?? 'other',
      status: update.status ?? 'pending',
      content: update.content ?? [],
      locations: update.locations ?? [],
      rawInput: update.rawInput,
      rawOutput: update.rawOutput,
      permission: null,
    }
    const entry: ChatToolEntry = {
      kind: 'tool',
      id: nextEntryId(),
      timestamp: Date.now(),
      toolCall,
    }
    this.toolEntryByCallId.set(update.toolCallId, entry.id)
    this.state = { ...this.state, entries: [...this.state.entries, entry] }
  }

  private findToolEntry(toolCallId: string): ChatToolEntry | null {
    const id = this.toolEntryByCallId.get(toolCallId)
    if (!id) return null
    const entry = this.state.entries.find(
      (item): item is ChatToolEntry => item.kind === 'tool' && item.id === id,
    )
    return entry ?? null
  }
}
