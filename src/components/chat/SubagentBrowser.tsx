import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useLanguage } from '../../contexts/language-context'
import { useSessionService } from '../../contexts/service-context'
import type {
  ChatSessionState,
  SubagentInfo,
  SubagentStatus,
} from '../../types/chat'

import { FrameBatcher } from './frameBatcher'
import Timeline from './Timeline'

function useStatusLabel() {
  const { t } = useLanguage()
  return (status: SubagentStatus): string => {
    switch (status) {
      case 'created':
        return t('chat.subagentCreated')
      case 'running':
        return t('chat.subagentRunning')
      case 'completed':
        return t('chat.subagentCompleted')
      case 'failed':
        return t('chat.subagentFailed')
      case 'interrupted':
        return t('chat.subagentInterrupted')
      default:
        return t('chat.subagentUnknown')
    }
  }
}

export default function SubagentBrowser({
  tabId,
  info,
  onBack,
  onOpen,
}: {
  tabId: string
  info: SubagentInfo
  onBack: () => void
  onOpen: (sessionId: string) => void
}) {
  const service = useSessionService()
  const { t } = useLanguage()
  const label = useStatusLabel()
  const [state, setState] = useState<ChatSessionState | null>(() =>
    service.getSubagentState(tabId, info.sessionId),
  )
  useEffect(() => {
    setState(service.getSubagentState(tabId, info.sessionId))
    const batcher = new FrameBatcher<ChatSessionState>(
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
      setState,
    )
    const unsubscribe = service.subscribeSubagent(
      tabId,
      info.sessionId,
      (next) => batcher.push(next),
    )
    void service.loadSubagent(tabId, info.sessionId).catch(() => undefined)
    return () => {
      unsubscribe()
      batcher.dispose()
    }
  }, [service, tabId, info.sessionId])
  return (
    <div className="yolo-subagent-browser">
      <div className="yolo-subagent-browser-header">
        <button
          type="button"
          className="clickable-icon"
          onClick={onBack}
          aria-label={t('chat.backToConversation')}
          title={t('chat.backToConversation')}
        >
          <ArrowLeft size={15} />
        </button>
        <span className="yolo-subagent-title">
          {info.title || t('chat.subagentUntitled')}
        </span>
        <span className="yolo-subagent-status">{label(info.status)}</span>
      </div>
      {state ? (
        <>
          <Timeline
            state={state}
            onOpenSubagent={onOpen}
            onPermissionRespond={(toolCallId, optionId) =>
              service.respondSubagentPermission(
                tabId,
                info.sessionId,
                toolCallId,
                optionId,
              )
            }
          />
          {state.error ? (
            <div className="yolo-acp-error-banner" role="alert">
              <div>{state.error}</div>
              {info.status !== 'failed' ? (
                <button
                  type="button"
                  onClick={() =>
                    void service
                      .loadSubagent(tabId, info.sessionId)
                      .catch(() => undefined)
                  }
                >
                  {t('common.retry')}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="yolo-subagent-browser-footer">
        {t('chat.subagentReadOnly')}
      </div>
    </div>
  )
}
