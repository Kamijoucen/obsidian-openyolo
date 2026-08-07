import type {
  AvailableCommand,
  ContentBlock,
  PermissionOption,
  SessionConfigOption,
  SessionMode,
  StopReason,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
  UsageUpdate,
} from '@agentclientprotocol/sdk'

export type PendingPermission = {
  options: PermissionOption[]
}

export type ToolCallState = {
  toolCallId: string
  title: string
  name?: string
  kind: ToolKind
  status: ToolCallStatus
  content: ToolCallContent[]
  locations: ToolCallLocation[]
  rawInput?: unknown
  rawOutput?: unknown
  permission: PendingPermission | null
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type TodoPriority = 'high' | 'medium' | 'low'

export type TodoEntry = {
  content: string
  status: TodoStatus
  priority: TodoPriority
}

export type ChatUserEntry = {
  kind: 'user'
  id: string
  messageId: string | null
  timestamp: number
  text: string
  blocks: ContentBlock[]
}

export type ChatAssistantEntry = {
  kind: 'assistant'
  id: string
  messageId: string
  timestamp: number
  text: string
  reasoning: string
  blocks: ContentBlock[]
  streaming: boolean
}

export type ChatToolEntry = {
  kind: 'tool'
  id: string
  timestamp: number
  toolCall: ToolCallState
}

export type TimelineEntry = ChatUserEntry | ChatAssistantEntry | ChatToolEntry

export type SessionStatus =
  'idle' | 'loading' | 'preparing' | 'running' | 'cancelling' | 'error'

export type SessionModeState = {
  current: string
  available: SessionMode[]
}

export type ChatSessionState = {
  sessionId: string | null
  title: string
  status: SessionStatus
  awaitingResponse: boolean
  error: string | null
  entries: TimelineEntry[]
  plan: TodoEntry[]
  usage: UsageUpdate | null
  mode: SessionModeState | null
  commands: AvailableCommand[]
  configOptions: SessionConfigOption[]
  lastStopReason: StopReason | null
}

export type HistorySessionInfo = {
  sessionId: string
  title: string
  updatedAt: string | null
}
