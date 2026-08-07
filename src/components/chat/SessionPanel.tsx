import { join } from 'path'
import { pathToFileURL } from 'url'

import type { ContentBlock } from '@agentclientprotocol/sdk'
import type { App } from 'obsidian'
import { memo, useCallback, useEffect, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { useLanguage } from '../../contexts/language-context'
import { useSessionService } from '../../contexts/service-context'
import type { ChatSessionState } from '../../types/chat'

import ChatInput, { AttachedNote, InputImage } from './ChatInput'
import type { SubmitResult } from './composer'
import { FrameBatcher } from './frameBatcher'
import TodoPanel from './PlanView'
import Timeline from './Timeline'

function vaultBasePath(app: App): string {
  const adapter = app.vault.adapter as { getBasePath?: () => string }
  return typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : ''
}

function mimeTypeFor(_name: string): string {
  // opencode 只会把 text/plain 附件的内容内联进提示词（其余 MIME 会变成
  // base64 文件附件，多数模型无法读取），因此文本附件统一用 text/plain。
  return 'text/plain'
}

function buildPromptBlocks(
  text: string,
  images: InputImage[],
  notes: AttachedNote[],
  basePath: string,
): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (text) {
    blocks.push({ type: 'text', text })
  }
  for (const image of images) {
    blocks.push({
      type: 'image',
      data: image.data,
      mimeType: image.mimeType,
    })
  }
  for (const note of notes) {
    const absolutePath = note.absolute
      ? note.path
      : basePath
        ? join(basePath, note.path)
        : note.path
    blocks.push({
      type: 'resource_link',
      uri: pathToFileURL(absolutePath).href,
      name: note.name,
      mimeType: mimeTypeFor(note.name),
    })
  }
  return blocks
}

function ErrorBanner({ error }: { error: string }) {
  const { t } = useLanguage()
  if (error === 'opencode-auth-required') {
    return (
      <div className="yolo-acp-error-banner">
        <div className="yolo-acp-error-title">
          {t('chat.authRequired', 'opencode is not authenticated')}
        </div>
        <div className="yolo-acp-error-hint">
          {t(
            'chat.authRequiredHint',
            'Run `opencode auth login` in a terminal, then retry.',
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="yolo-acp-error-banner">
      <div className="yolo-acp-error-title">{error}</div>
    </div>
  )
}

type SessionPanelProps = {
  tabId: string
}

function SessionPanel({ tabId }: SessionPanelProps) {
  const service = useSessionService()
  const app = useApp()
  const [state, setState] = useState<ChatSessionState | null>(() =>
    service.getState(tabId),
  )

  useEffect(() => {
    setState(service.getState(tabId))
    const batcher = new FrameBatcher<ChatSessionState>(
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
      setState,
    )
    const unsubscribe = service.subscribe(tabId, (next) => batcher.push(next))
    return () => {
      unsubscribe()
      batcher.dispose()
    }
  }, [service, tabId])

  const handleSubmit = useCallback(
    async (
      text: string,
      images: InputImage[],
      notes: AttachedNote[],
    ): Promise<SubmitResult> => {
      const blocks = buildPromptBlocks(text, images, notes, vaultBasePath(app))
      return service.submit(tabId, text, blocks)
    },
    [service, tabId, app],
  )

  const handleCancel = useCallback(() => {
    void service.cancel(tabId)
  }, [service, tabId])

  const handlePermissionRespond = useCallback(
    (toolCallId: string, optionId: string) => {
      service.respondPermission(tabId, toolCallId, optionId)
    },
    [service, tabId],
  )

  const handleModeChange = useCallback(
    (modeId: string) => {
      void service.setMode(tabId, modeId)
    },
    [service, tabId],
  )

  const handleConfigOptionChange = useCallback(
    (configId: string, value: string) => {
      void service.setConfigOption(tabId, configId, value)
    },
    [service, tabId],
  )

  if (!state) return null
  const running = ['preparing', 'running', 'cancelling'].includes(state.status)

  return (
    <div className="yolo-acp-session is-active">
      <Timeline state={state} onPermissionRespond={handlePermissionRespond} />
      <div className="yolo-chat-footer">
        {state.plan.length > 0 ? <TodoPanel entries={state.plan} /> : null}
        {state.error ? <ErrorBanner error={state.error} /> : null}
        <ChatInput
          running={running}
          disabled={state.status === 'loading'}
          commands={state.commands}
          mode={state.mode}
          configOptions={state.configOptions}
          onModeChange={handleModeChange}
          onConfigOptionChange={handleConfigOptionChange}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </div>
    </div>
  )
}

export default memo(SessionPanel)
