import { App, PluginSettingTab, Setting } from 'obsidian'

import { getDefaultSystemPrompt } from '../core/acp/agentsMd'
import { getUiLanguage, t } from '../i18n'
import type YoloPlugin from '../main'

export class YoloSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: YoloPlugin,
  ) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    const { settings } = this.plugin
    const defaultSystemPrompt = getDefaultSystemPrompt(getUiLanguage())

    new Setting(containerEl).setName(t('settings.title')).setHeading()

    new Setting(containerEl).setName(t('settings.connection')).setHeading()

    const service = this.plugin.getSessionService()
    const agentInfo = service.getAgentInfo()
    const availability = service.getAvailability()
    new Setting(containerEl)
      .setName(t('settings.agentInfo'))
      .setDesc(
        agentInfo
          ? `${agentInfo.name} ${agentInfo.version} · ${t('setup.connected')}`
          : availability === 'starting'
            ? t('setup.starting')
            : t('settings.notConnected'),
      )

    new Setting(containerEl)
      .setName(t('settings.opencodePath'))
      .setDesc(t('settings.opencodePathDesc'))
      .addText((text) =>
        text
          .setPlaceholder(
            process.platform === 'win32'
              ? 'C:\\path\\to\\opencode.exe'
              : '/usr/local/bin/opencode',
          )
          .setValue(settings.opencodePath)
          .onChange(async (value) => {
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              opencodePath: value.trim(),
            })
          }),
      )

    new Setting(containerEl)
      .setName(t('settings.opencodeArgs'))
      .setDesc(t('settings.opencodeArgsDesc'))
      .addTextArea((text) =>
        text
          .setPlaceholder('--flag\n--option=value')
          .setValue(settings.opencodeArgs.join('\n'))
          .onChange(async (value) => {
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              opencodeArgs: value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }),
      )

    new Setting(containerEl).setName(t('settings.behavior')).setHeading()

    new Setting(containerEl)
      .setName(t('settings.manageAgentsMd'))
      .setDesc(t('settings.manageAgentsMdDesc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.manageAgentsMd).onChange(async (value) => {
          await this.plugin.saveSettings({
            ...this.plugin.settings,
            manageAgentsMd: value,
          })
        }),
      )

    new Setting(containerEl)
      .setName(t('settings.systemPrompt'))
      .setDesc(t('settings.systemPromptDesc'))
      .addExtraButton((button) =>
        button
          .setIcon('reset')
          .setTooltip(t('settings.resetPrompt'))
          .onClick(async () => {
            if (promptSaveTimer) window.clearTimeout(promptSaveTimer)
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              systemPrompt: defaultSystemPrompt,
            })
            this.display()
          }),
      )

    let promptSaveTimer: number | null = null
    const promptArea = containerEl.createEl('textarea', {
      cls: 'yolo-settings-prompt-textarea',
    })
    promptArea.value = settings.systemPrompt
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

    new Setting(containerEl)
      .setName(t('settings.defaultMode'))
      .setDesc(t('settings.defaultModeDesc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('build', t('chat.modeBuild'))
          .addOption('plan', t('chat.modePlan'))
          .setValue(settings.defaultMode)
          .onChange(async (value) => {
            if (value !== 'build' && value !== 'plan') return
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              defaultMode: value,
            })
          }),
      )

    new Setting(containerEl)
      .setName(t('settings.autoApprove'))
      .setDesc(t('settings.autoApproveDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(settings.autoApprovePermissions)
          .onChange(async (value) => {
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              autoApprovePermissions: value,
            })
          }),
      )

    new Setting(containerEl)
      .setName(t('settings.showReasoning'))
      .setDesc(t('settings.showReasoningDesc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.showReasoning).onChange(async (value) => {
          await this.plugin.saveSettings({
            ...this.plugin.settings,
            showReasoning: value,
          })
        }),
      )

    new Setting(containerEl)
      .setName(t('settings.debugLog'))
      .setDesc(t('settings.debugLogDesc'))
      .addToggle((toggle) =>
        toggle.setValue(settings.debugLog).onChange(async (value) => {
          await this.plugin.saveSettings({
            ...this.plugin.settings,
            debugLog: value,
          })
        }),
      )
  }
}
