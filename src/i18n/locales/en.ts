import type { TranslationKeys } from '../types'

export const en: TranslationKeys = {
  commands: {
    openChat: 'Open chat',
  },
  common: {
    retry: 'Retry',
    loading: 'Loading…',
    send: 'Send',
    stop: 'Stop',
  },
  chat: {
    newChat: 'New chat',
    untitled: 'New chat',
    history: 'History',
    historyEmpty: 'No previous sessions',
    inputPlaceholder: 'Ask anything… ( / for commands)',
    stopGenerating: 'Stop generating',
    generating: 'Generating…',
    attachFile: 'Attach file',
    attach: 'Add attachment',
    searchNotes: 'Search notes…',
    modePlan: 'Plan',
    modeBuild: 'Build',
    searchModels: 'Search models…',
    reasoning: 'Reasoning',
    todoTitle: 'Plan',
    permissionTitle: 'Permission required',
    allowOnce: 'Allow once',
    allowAlways: 'Always allow',
    reject: 'Reject',
    emptyConversation: 'Start a conversation with opencode.',
    authRequired: 'opencode is not authenticated',
    authRequiredHint: 'Run `opencode auth login` in a terminal, then retry.',
    sessionLoading: 'Loading session…',
  },
  setup: {
    notFound: 'opencode binary not found',
    notFoundHint:
      'Install opencode (https://opencode.ai) and make sure `opencode` is on PATH, or set the binary path in settings.',
    starting: 'Starting opencode…',
    startingHint: 'This may take a few seconds.',
    openSettings: 'Open settings',
    exited: 'opencode process exited',
    connected: 'Connected',
  },
  settings: {
    title: 'OpenYOLO',
    connection: 'Backend',
    agentInfo: 'Agent',
    notConnected: 'Not connected',
    opencodePath: 'opencode binary path',
    opencodePathDesc:
      'Absolute path to the opencode binary. Leave empty to resolve from PATH.',
    opencodeArgs: 'Extra ACP arguments',
    opencodeArgsDesc:
      'Additional arguments appended after `opencode acp`, one per line.',
    behavior: 'Behavior',
    defaultMode: 'Default mode',
    defaultModeDesc:
      'Mode used for new sessions. Plan is read-only, Build can modify files.',
    systemPrompt: 'Note assistant prompt',
    systemPromptDesc:
      'Written into AGENTS.md at the vault root as opencode project rules. It guides the assistant to work on notes instead of code.',
    manageAgentsMd: 'Manage AGENTS.md',
    manageAgentsMdDesc:
      'Let the plugin maintain a managed block in the vault-root AGENTS.md. Your own content outside the block is preserved.',
    resetPrompt: 'Reset to default',
    autoApprove: 'Auto-approve permissions (YOLO)',
    autoApproveDesc:
      'Automatically approve every tool permission request without asking.',
    showReasoning: 'Show reasoning',
    showReasoningDesc: 'Display model thinking blocks in the timeline.',
    debugLog: 'Debug logging',
    debugLogDesc: 'Log ACP traffic and opencode stderr to the console.',
  },
  statusBar: {
    running: 'OpenYOLO: running',
  },
}
