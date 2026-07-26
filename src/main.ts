import { Notice, Platform, Plugin, WorkspaceLeaf, addIcon } from 'obsidian'

import { ChatView } from './ChatView'
import { syncAgentsMd } from './core/acp/agentsMd'
import type { AcpSessionService } from './core/acp/service'
import { getUiLanguage, loadLocale, t } from './i18n'
import {
  DEFAULT_SETTINGS,
  YoloSettings,
  normalizeSettings,
} from './settings/schema/setting.types'
import { YoloSettingTab } from './settings/SettingTab'
import { YOLO_ICON_ID, YOLO_ICON_SVG } from './yoloIcon'

export const CHAT_VIEW_TYPE = 'yolo-lite-chat-view'

export default class YoloPlugin extends Plugin {
  settings: YoloSettings = DEFAULT_SETTINGS
  private sessionService: AcpSessionService | null = null
  private settingsListeners = new Set<(settings: YoloSettings) => void>()
  private statusBarItem: HTMLElement | null = null
  private agentsMdSyncTimer: number | null = null

  async onload() {
    await Promise.all([loadLocale('en'), loadLocale('zh')])
    await this.loadSettings()

    if (!Platform.isDesktopApp) {
      new Notice('OpenYOLO requires Obsidian desktop.')
      return
    }

    const { AcpSessionService } = await import('./core/acp/service')
    this.sessionService = new AcpSessionService(
      this.app,
      () => this.settings,
      this.manifest.version,
      (configId, value) => {
        this.settings = {
          ...this.settings,
          savedConfigSelections: {
            ...this.settings.savedConfigSelections,
            [configId]: value,
          },
        }
        void this.saveData(this.settings)
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

    this.addSettingTab(new YoloSettingTab(this.app, this))

    this.statusBarItem = this.addStatusBarItem()
    this.sessionService.onActivityChange(() => this.updateStatusBar())
    this.updateStatusBar()
  }

  onunload() {
    void this.sessionService?.dispose()
    this.sessionService = null
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
    const { workspace } = this.app
    const open = async () => {
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
      workspace.onLayoutReady(() => {
        void open()
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
    this.settings = normalizeSettings(await this.loadData(), getUiLanguage())
  }

  async saveSettings(next: YoloSettings) {
    this.settings = next
    await this.saveData(next)
    for (const listener of this.settingsListeners) {
      listener(next)
    }
    this.scheduleAgentsMdSync()
  }

  private scheduleAgentsMdSync() {
    if (this.agentsMdSyncTimer) {
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
