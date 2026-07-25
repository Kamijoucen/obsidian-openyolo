export type Language = 'en' | 'zh'

export type TranslationKeys = {
  commands: {
    openChat: string
  }
  common: {
    retry: string
    loading: string
    send: string
    stop: string
  }
  chat: {
    newChat: string
    untitled: string
    history: string
    historyEmpty: string
    inputPlaceholder: string
    stopGenerating: string
    generating: string
    attachFile: string
    attach: string
    searchNotes: string
    modePlan: string
    modeBuild: string
    searchModels: string
    reasoning: string
    todoTitle: string
    permissionTitle: string
    allowOnce: string
    allowAlways: string
    reject: string
    emptyConversation: string
    authRequired: string
    authRequiredHint: string
    sessionLoading: string
  }
  setup: {
    notFound: string
    notFoundHint: string
    starting: string
    startingHint: string
    openSettings: string
    exited: string
    connected: string
  }
  settings: {
    title: string
    connection: string
    agentInfo: string
    notConnected: string
    opencodePath: string
    opencodePathDesc: string
    opencodeArgs: string
    opencodeArgsDesc: string
    behavior: string
    defaultMode: string
    defaultModeDesc: string
    systemPrompt: string
    systemPromptDesc: string
    manageAgentsMd: string
    manageAgentsMdDesc: string
    resetPrompt: string
    autoApprove: string
    autoApproveDesc: string
    showReasoning: string
    showReasoningDesc: string
    debugLog: string
    debugLogDesc: string
  }
  statusBar: {
    running: string
  }
}
