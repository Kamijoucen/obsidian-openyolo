import {
  DEFAULT_SYSTEM_PROMPT_ZH,
  getDefaultSystemPrompt,
} from '../../core/acp/agentsMd'
import type { PromptLanguage } from '../../core/acp/agentsMd'

export type ChatMode = 'plan' | 'build'

export type YoloSettings = {
  opencodePath: string
  opencodeArgs: string[]
  defaultMode: ChatMode
  autoApprovePermissions: boolean
  showReasoning: boolean
  debugLog: boolean
  attachCurrentNote: boolean
  systemPrompt: string
  manageAgentsMd: boolean
  /** 记录用户选择的模型/思考强度等 configOption（configId → value），跨会话与重启恢复 */
  savedConfigSelections: Record<string, string>
}

export const DEFAULT_SETTINGS: YoloSettings = {
  opencodePath: '',
  opencodeArgs: [],
  defaultMode: 'build',
  autoApprovePermissions: false,
  showReasoning: true,
  debugLog: false,
  attachCurrentNote: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT_ZH,
  manageAgentsMd: false,
  savedConfigSelections: {},
}

export function normalizeSettings(
  raw: unknown,
  language: PromptLanguage = 'zh',
): YoloSettings {
  const source =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {}
  return {
    opencodePath:
      typeof source.opencodePath === 'string'
        ? source.opencodePath
        : DEFAULT_SETTINGS.opencodePath,
    opencodeArgs: Array.isArray(source.opencodeArgs)
      ? source.opencodeArgs.filter(
          (item): item is string => typeof item === 'string',
        )
      : DEFAULT_SETTINGS.opencodeArgs,
    defaultMode:
      source.defaultMode === 'plan' || source.defaultMode === 'build'
        ? source.defaultMode
        : DEFAULT_SETTINGS.defaultMode,
    autoApprovePermissions:
      typeof source.autoApprovePermissions === 'boolean'
        ? source.autoApprovePermissions
        : DEFAULT_SETTINGS.autoApprovePermissions,
    showReasoning:
      typeof source.showReasoning === 'boolean'
        ? source.showReasoning
        : DEFAULT_SETTINGS.showReasoning,
    debugLog:
      typeof source.debugLog === 'boolean'
        ? source.debugLog
        : DEFAULT_SETTINGS.debugLog,
    attachCurrentNote:
      typeof source.attachCurrentNote === 'boolean'
        ? source.attachCurrentNote
        : DEFAULT_SETTINGS.attachCurrentNote,
    systemPrompt:
      typeof source.systemPrompt === 'string' && source.systemPrompt.trim()
        ? source.systemPrompt
        : getDefaultSystemPrompt(language),
    manageAgentsMd:
      typeof source.manageAgentsMd === 'boolean'
        ? source.manageAgentsMd
        : DEFAULT_SETTINGS.manageAgentsMd,
    savedConfigSelections:
      typeof source.savedConfigSelections === 'object' &&
      source.savedConfigSelections !== null &&
      !Array.isArray(source.savedConfigSelections)
        ? Object.fromEntries(
            Object.entries(
              source.savedConfigSelections as Record<string, unknown>,
            ).filter((entry): entry is [string, string] => {
              return typeof entry[1] === 'string'
            }),
          )
        : DEFAULT_SETTINGS.savedConfigSelections,
  }
}
