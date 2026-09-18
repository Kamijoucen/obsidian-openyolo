import { ItemView, WorkspaceLeaf } from 'obsidian'
import React from 'react'
import { Root, createRoot } from 'react-dom/client'

import ChatApp from './components/chat/ChatApp'
import { AppProvider } from './contexts/app-context'
import { InputHistoryProvider } from './contexts/input-history-context'
import { LanguageProvider } from './contexts/language-context'
import { ServiceProvider } from './contexts/service-context'
import { SettingsProvider } from './contexts/settings-context'
import YoloPlugin, { CHAT_VIEW_TYPE } from './main'
import { YOLO_ICON_ID } from './yoloIcon'

export class ChatView extends ItemView {
  private root: Root | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: YoloPlugin,
  ) {
    super(leaf)
  }

  getViewType() {
    return CHAT_VIEW_TYPE
  }

  getDisplayText() {
    return 'OpenYOLO'
  }

  getIcon() {
    return YOLO_ICON_ID
  }

  async onOpen(): Promise<void> {
    if (this.root) {
      this.root.unmount()
      this.root = null
    }
    const container = this.contentEl
    container.empty()
    container.addClass('yolo-chat-view')
    const root = createRoot(container)
    this.root = root
    root.render(
      <AppProvider app={this.app}>
        <SettingsProvider
          settings={this.plugin.settings}
          setSettings={(next) => this.plugin.saveSettings(next)}
          addSettingsChangeListener={(listener) =>
            this.plugin.addSettingsChangeListener(listener)
          }
        >
          <LanguageProvider>
            <ServiceProvider service={this.plugin.getSessionService()}>
              <InputHistoryProvider value={this.plugin.inputHistory}>
                <ChatApp onOpenSettings={() => this.plugin.openSettings()} />
              </InputHistoryProvider>
            </ServiceProvider>
          </LanguageProvider>
        </SettingsProvider>
      </AppProvider>,
    )
  }

  async onClose(): Promise<void> {
    this.root?.unmount()
    this.root = null
  }
}
