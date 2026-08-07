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
    historyLoadFailed: string
    inputPlaceholder: string
    stopGenerating: string
    generating: string
    attachFile: string
    attach: string
    removeAttachment: string
    attachedImage: string
    attachedAudio: string
    contentTruncated: string
    removeImage: string
    imageTooLarge: string
    imageCountLimit: string
    imageTotalLimit: string
    imageReadFailed: string
    diffPreviewTruncated: string
    searchNotes: string
    noteResultsLimited: string
    modePlan: string
    modeBuild: string
    searchModels: string
    reasoning: string
    todoTitle: string
    todoPending: string
    todoInProgress: string
    todoCompleted: string
    todoCancelled: string
    todoPriorityHigh: string
    todoPriorityMedium: string
    todoPriorityLow: string
    todoExpand: string
    todoCollapse: string
    subagentOutput: string
    subagentRunning: string
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
    desktopRequired: string
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
    backendRestartFailed: string
    behavior: string
    attachCurrentNote: string
    attachCurrentNoteDesc: string
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
