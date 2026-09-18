import { Notice, Platform, Plugin, WorkspaceLeaf, addIcon } from 'obsidian'

import { ChatView } from './ChatView'
import { syncAgentsMd } from './core/acp/agentsMd'
import type { AcpSessionService } from './core/acp/service'
import { InputHistory } from './core/inputHistory'
import { getUiLanguage, loadLocale, t } from './i18n'
import { sameConnectionSettings } from './settings/connectionSettings'
import {
  DEFAULT_SETTINGS,
  YoloSettings,
  normalizeSettings,
} from './settings/schema/setting.types'
import { SerialWriter } from './settings/serialWriter'
import { YoloSettingTab } from './settings/SettingTab'
import { YOLO_ICON_ID, YOLO_ICON_SVG } from './yoloIcon'

export const CHAT_VIEW_TYPE = 'yolo-lite-chat-view'

const CONNECTION_RESTART_DEBOUNCE_MS = 750

type PluginData = YoloSettings & { inputHistory: readonly string[] }

export default class YoloPlugin extends Plugin {
  settings: YoloSettings = DEFAULT_SETTINGS
  readonly inputHistory = new InputHistory(() => this.savePluginData())
  private sessionService: AcpSessionService | null = null
  private settingsListeners = new Set<(settings: YoloSettings) => void>()
  private statusBarItem: HTMLElement | null = null
  private agentsMdSyncTimer: number | null = null
  private connectionRestartTimer: number | null = null
  private settingTab: YoloSettingTab | null = null
  private unsubscribeActivityChange: (() => void) | null = null
  private activationPromise: Promise<void> | null = null
  private unloading = false
  private readonly settingsWriter = new SerialWriter<PluginData>((data) =>
    this.saveData(data),
  )

  async onload() {
    this.unloading = false
    await Promise.all([loadLocale('en'), loadLocale('zh')])
    await this.loadSettings()

    if (!Platform.isDesktopApp) {
      new Notice(
        t('setup.desktopRequired', 'OpenYOLO requires Obsidian desktop.'),
      )
      return
    }

    const { AcpSessionService } = await import('./core/acp/service')
    this.sessionService = new AcpSessionService(
      this.app,
      () => this.settings,
      this.manifest.version,
      (configId, value) => {
        const next = {
          ...this.settings,
          savedConfigSelections: {
            ...this.settings.savedConfigSelections,
            [configId]: value,
          },
        }
        void this.saveSettings(next)
      },
    )
    void this.syncAgentsMdNow()

    addIcon(YOLO_ICON_ID, YOLO_ICON_SVG)
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ChatView(leaf, this),
    )

    this.addRibbonIcon(YOLO_ICON_ID, 'OpenYOLO', () => {
      void this.activateView()
    })

    this.addCommand({
      id: 'open-chat',
      name: t('commands.openChat'),
      callback: () => {
        void this.activateView()
      },
    })

    this.settingTab = new YoloSettingTab(this.app, this)
    this.addSettingTab(this.settingTab)

    this.statusBarItem = this.addStatusBarItem()
    this.unsubscribeActivityChange = this.sessionService.onActivityChange(() =>
      this.updateStatusBar(),
    )
    this.updateStatusBar()
  }

  onunload() {
    this.unloading = true
    this.cancelConnectionRestart()
    this.settingTab?.dispose()
    this.unsubscribeActivityChange?.()

    if (this.agentsMdSyncTimer !== null) {
      window.clearTimeout(this.agentsMdSyncTimer)
      this.agentsMdSyncTimer = null
    }

    const service = this.sessionService
    void service?.dispose()

    this.settingTab = null
    this.unsubscribeActivityChange = null
    this.sessionService = null
    this.statusBarItem = null
    this.activationPromise = null
  }

  private updateStatusBar() {
    if (!this.statusBarItem || !this.sessionService) return
    const running = this.sessionService.getRunningCount()
    this.statusBarItem.setText(
      running > 0 ? t('statusBar.running', 'YOLO: running') : '',
    )
  }

  getSessionService(): AcpSessionService {
    if (!this.sessionService) {
      throw new Error('Session service is unavailable on this platform')
    }
    return this.sessionService
  }

  async activateView() {
    if (this.activationPromise) return this.activationPromise
    const activation = this.activateViewInternal()
    this.activationPromise = activation
    try {
      await activation
    } finally {
      if (this.activationPromise === activation) this.activationPromise = null
    }
  }

  private async activateViewInternal() {
    const { workspace } = this.app
    const open = async () => {
      if (this.unloading || !this.sessionService) return
      let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]
      if (!leaf) {
        leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true)
        await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true })
      }
      void workspace.revealLeaf(leaf)
    }
    if (workspace.layoutReady) {
      await open()
    } else {
      await new Promise<void>((resolve) => {
        workspace.onLayoutReady(() => {
          void open().finally(resolve)
        })
      })
    }
  }

  openSettings() {
    const setting = (
      this.app as unknown as {
        setting?: { open?: () => void; openTabById?: (id: string) => void }
      }
    ).setting
    setting?.open?.()
    setting?.openTabById?.(this.manifest.id)
  }

  async loadSettings() {
    const data: unknown = await this.loadData()
    this.settings = normalizeSettings(data, getUiLanguage())
    this.inputHistory.restore(
      typeof data === 'object' && data !== null && 'inputHistory' in data
        ? data.inputHistory
        : undefined,
    )
  }

  private savePluginData(): Promise<void> {
    return this.settingsWriter.write({
      ...this.settings,
      inputHistory: this.inputHistory.getEntries(),
    })
  }

  async saveSettings(next: YoloSettings) {
    const previous = this.settings
    const connectionChanged = !sameConnectionSettings(previous, next)
    if (connectionChanged) this.cancelConnectionRestart()
    this.settings = next
    for (const listener of this.settingsListeners) {
      listener(next)
    }
    if (
      previous.manageAgentsMd !== next.manageAgentsMd ||
      previous.systemPrompt !== next.systemPrompt
    ) {
      this.scheduleAgentsMdSync()
    }
    await this.savePluginData()
    if (
      connectionChanged &&
      !this.unloading &&
      sameConnectionSettings(this.settings, next)
    ) {
      this.scheduleConnectionRestart(next)
    }
  }

  private scheduleConnectionRestart(settings: YoloSettings) {
    this.cancelConnectionRestart()
    this.connectionRestartTimer = window.setTimeout(() => {
      this.connectionRestartTimer = null
      if (this.unloading || !sameConnectionSettings(this.settings, settings)) {
        return
      }
      void this.restartBackend()
    }, CONNECTION_RESTART_DEBOUNCE_MS)
  }

  private cancelConnectionRestart() {
    if (this.connectionRestartTimer === null) return
    window.clearTimeout(this.connectionRestartTimer)
    this.connectionRestartTimer = null
  }

  private async restartBackend() {
    try {
      await this.sessionService?.restart()
    } catch (error) {
      console.warn('[openyolo] failed to restart ACP backend', error)
      new Notice(
        t(
          'settings.backendRestartFailed',
          'Saved the connection settings, but restarting opencode failed.',
        ),
      )
    }
  }

  private scheduleAgentsMdSync() {
    if (this.agentsMdSyncTimer !== null) {
      window.clearTimeout(this.agentsMdSyncTimer)
    }
    this.agentsMdSyncTimer = window.setTimeout(() => {
      this.agentsMdSyncTimer = null
      void this.syncAgentsMdNow()
    }, 1000)
  }

  private async syncAgentsMdNow() {
    if (!Platform.isDesktopApp) return
    try {
      await syncAgentsMd(
        this.app,
        this.settings.systemPrompt,
        this.settings.manageAgentsMd,
      )
    } catch (error) {
      console.warn('[openyolo] failed to sync AGENTS.md', error)
    }
  }

  addSettingsChangeListener(
    listener: (settings: YoloSettings) => void,
  ): () => void {
    this.settingsListeners.add(listener)
    return () => {
      this.settingsListeners.delete(listener)
    }
  }
}
