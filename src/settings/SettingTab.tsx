import { App, PluginSettingTab, Setting } from 'obsidian'
import type { SettingDefinitionItem } from 'obsidian'

import { getDefaultSystemPrompt } from '../core/acp/agentsMd'
import { getUiLanguage, t } from '../i18n'
import type YoloPlugin from '../main'

import type { YoloSettings } from './schema/setting.types'

export class YoloSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: YoloPlugin,
  ) {
    super(app, plugin)
    this.plugin.getSessionService().onAvailabilityChange(() => this.update())
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const service = this.plugin.getSessionService()
    const agentInfo = service.getAgentInfo()
    const availability = service.getAvailability()

    return [
      {
        type: 'group',
        heading: t('settings.connection'),
        items: [
          {
            name: t('settings.agentInfo'),
            desc: agentInfo
              ? `${agentInfo.name} ${agentInfo.version} · ${t('setup.connected')}`
              : availability === 'starting'
                ? t('setup.starting')
                : (service.getStartError() ?? t('settings.notConnected')),
          },
          {
            name: t('settings.opencodePath'),
            desc: t('settings.opencodePathDesc'),
            control: {
              type: 'text',
              key: 'opencodePath',
              placeholder:
                process.platform === 'win32'
                  ? 'C:\\path\\to\\opencode.exe'
                  : '/usr/local/bin/opencode',
            },
          },
          {
            name: t('settings.opencodeArgs'),
            desc: t('settings.opencodeArgsDesc'),
            control: {
              type: 'textarea',
              key: 'opencodeArgs',
              placeholder: '--flag\n--option=value',
            },
          },
        ],
      },
      {
        type: 'group',
        heading: t('settings.behavior'),
        items: [
          {
            name: t('settings.manageAgentsMd'),
            desc: t('settings.manageAgentsMdDesc'),
            control: { type: 'toggle', key: 'manageAgentsMd' },
          },
          {
            name: t('settings.systemPrompt'),
            desc: t('settings.systemPromptDesc'),
            render: (setting) => this.renderSystemPrompt(setting),
          },
          {
            name: t('settings.defaultMode'),
            desc: t('settings.defaultModeDesc'),
            control: {
              type: 'dropdown',
              key: 'defaultMode',
              options: {
                build: t('chat.modeBuild'),
                plan: t('chat.modePlan'),
              },
            },
          },
          {
            name: t('settings.autoApprove'),
            desc: t('settings.autoApproveDesc'),
            control: { type: 'toggle', key: 'autoApprovePermissions' },
          },
          {
            name: t('settings.showReasoning'),
            desc: t('settings.showReasoningDesc'),
            control: { type: 'toggle', key: 'showReasoning' },
          },
          {
            name: t('settings.debugLog'),
            desc: t('settings.debugLogDesc'),
            control: { type: 'toggle', key: 'debugLog' },
          },
        ],
      },
    ]
  }

  override getControlValue(key: string): unknown {
    const value = this.plugin.settings[key as keyof YoloSettings]
    return Array.isArray(value) ? value.join('\n') : value
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const next = { ...this.plugin.settings }
    switch (key) {
      case 'opencodePath':
        next.opencodePath = String(value).trim()
        break
      case 'opencodeArgs':
        next.opencodeArgs = String(value)
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        break
      case 'defaultMode': {
        const mode =
          value === 'plan' ? 'plan' : value === 'build' ? 'build' : null
        if (!mode) return
        next.defaultMode = mode
        break
      }
      case 'manageAgentsMd':
      case 'autoApprovePermissions':
      case 'showReasoning':
      case 'debugLog':
        next[key] = Boolean(value)
        break
      default:
        return
    }
    await this.plugin.saveSettings(next)
  }

  private renderSystemPrompt(setting: Setting): () => void {
    const defaultSystemPrompt = getDefaultSystemPrompt(getUiLanguage())
    let promptSaveTimer: number | null = null

    setting.settingEl.addClass('yolo-settings-prompt-setting')
    setting.addExtraButton((button) =>
      button
        .setIcon('reset')
        .setTooltip(t('settings.resetPrompt'))
        .onClick(async () => {
          if (promptSaveTimer) window.clearTimeout(promptSaveTimer)
          await this.plugin.saveSettings({
            ...this.plugin.settings,
            systemPrompt: defaultSystemPrompt,
          })
          this.update()
        }),
    )

    const promptArea = setting.controlEl.createEl('textarea', {
      cls: 'yolo-settings-prompt-textarea',
    })
    promptArea.value = this.plugin.settings.systemPrompt
    promptArea.rows = 12
    promptArea.spellcheck = false
    promptArea.addEventListener('input', () => {
      if (promptSaveTimer) window.clearTimeout(promptSaveTimer)
      promptSaveTimer = window.setTimeout(() => {
        void this.plugin.saveSettings({
          ...this.plugin.settings,
          systemPrompt: promptArea.value.trim() || defaultSystemPrompt,
        })
      }, 600)
    })

    return () => {
      if (promptSaveTimer) window.clearTimeout(promptSaveTimer)
    }
  }
}
