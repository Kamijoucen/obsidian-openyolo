import { Loader2 } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'

import { useLanguage } from '../../contexts/language-context'
import { shouldHideTodoToolCall } from '../../core/acp/todos'
import type { ChatSessionState } from '../../types/chat'

import { AssistantEntryView, UserEntryView } from './entries'
import ToolCallCard from './ToolCallCard'

type TimelineProps = {
  state: ChatSessionState
  onPermissionRespond: (toolCallId: string, optionId: string) => void
}

function Timeline({ state, onPermissionRespond }: TimelineProps) {
  const { t } = useLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pinnedToBottomRef = useRef(true)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !pinnedToBottomRef.current) return
    container.scrollTop = container.scrollHeight
  }, [state.entries, state.plan])

  useEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    const ownerWindow = container?.ownerDocument.defaultView
    if (!container || !content || !ownerWindow) return
    // Native Markdown post-processors (math, diagrams, embeds) can finish
    // after the state update that added the text.
    const observer = new ownerWindow.ResizeObserver(() => {
      if (pinnedToBottomRef.current)
        container.scrollTop = container.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const handleScroll = () => {
    const container = containerRef.current
    if (!container) return
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight
    pinnedToBottomRef.current = distance < 80
  }

  return (
    <div
      className="yolo-chat-messages yolo-chat-messages--following"
      ref={containerRef}
      onScroll={handleScroll}
    >
      <div ref={contentRef} className="yolo-chat-timeline-content">
        {state.status === 'loading' ? (
          <div className="yolo-acp-empty-hint">
            {t('chat.sessionLoading', 'Loading session…')}
          </div>
        ) : null}
        {state.entries.length === 0 && state.status !== 'loading' ? (
          <div className="yolo-acp-empty-hint">
            {t('chat.emptyConversation', 'Start a conversation with opencode.')}
          </div>
        ) : null}
        {state.entries.map((entry) => {
          switch (entry.kind) {
            case 'user':
              return (
                <div key={entry.id} className="yolo-chat-timeline-row">
                  <UserEntryView entry={entry} />
                </div>
              )
            case 'assistant':
              return (
                <div key={entry.id} className="yolo-chat-timeline-row">
                  <AssistantEntryView entry={entry} />
                </div>
              )
            case 'tool':
              if (shouldHideTodoToolCall(entry.toolCall)) {
                return null
              }
              return (
                <div key={entry.id} className="yolo-chat-timeline-row">
                  <ToolCallCard
                    toolCall={entry.toolCall}
                    onPermissionRespond={onPermissionRespond}
                  />
                </div>
              )
            default:
              return null
          }
        })}
        {state.awaitingResponse ? (
          <div
            className="yolo-chat-timeline-row yolo-acp-generating"
            role="status"
            aria-live="polite"
          >
            <Loader2
              size={14}
              className="yolo-acp-generating-spinner"
              aria-hidden="true"
            />
            <span>{t('chat.generating', 'Generating…')}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default memo(Timeline)
