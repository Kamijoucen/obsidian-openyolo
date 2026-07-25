import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useState } from 'react'

import { useLanguage } from '../../contexts/language-context'
import { useSettings } from '../../contexts/settings-context'
import type { ChatAssistantEntry, ChatUserEntry } from '../../types/chat'

import StreamingMarkdown from './StreamingMarkdown'

export const UserEntryView = memo(function UserEntryView({
  entry,
}: {
  entry: ChatUserEntry
}) {
  const images = entry.blocks.filter((block) => block.type === 'image')
  const links = entry.blocks.filter((block) => block.type === 'resource_link')
  return (
    <div className="yolo-chat-messages-user">
      <div className="yolo-chat-user-input-wrapper--compact">
        <div className="yolo-chat-user-input-container">
          {entry.text ? (
            <div className="yolo-chat-user-input-editor">{entry.text}</div>
          ) : null}
          {links.length > 0 ? (
            <div className="yolo-acp-user-links">
              {links.map((block, index) =>
                block.type === 'resource_link' ? (
                  <span key={index} className="yolo-acp-user-link-chip">
                    {block.name || block.uri}
                  </span>
                ) : null,
              )}
            </div>
          ) : null}
          {images.length > 0 ? (
            <div className="yolo-acp-user-images">
              {images.map((block, index) =>
                block.type === 'image' ? (
                  <img
                    key={index}
                    src={`data:${block.mimeType};base64,${block.data}`}
                    alt=""
                  />
                ) : null,
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
})

export const AssistantEntryView = memo(function AssistantEntryView({
  entry,
}: {
  entry: ChatAssistantEntry
}) {
  const { settings } = useSettings()
  const { t } = useLanguage()
  const [reasoningOpen, setReasoningOpen] = useState(true)
  const showReasoning = settings.showReasoning && entry.reasoning.length > 0

  return (
    <div className="yolo-chat-messages-assistant">
      {showReasoning ? (
        <div className="yolo-assistant-message-metadata">
          <button
            type="button"
            className="yolo-assistant-message-metadata-toggle"
            onClick={() => setReasoningOpen(!reasoningOpen)}
          >
            <span className="yolo-assistant-message-metadata-label">
              <Brain size={12} />
              <span className="yolo-assistant-message-metadata-label-text">
                {t('chat.reasoning', 'Reasoning')}
              </span>
              <span className="yolo-assistant-message-metadata-toggle-icon">
                {reasoningOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </span>
            </span>
          </button>
          {reasoningOpen ? (
            <div className="yolo-assistant-message-metadata-content">
              <div className="yolo-assistant-message-metadata-body">
                <StreamingMarkdown content={entry.reasoning} scale="xs" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {entry.text ? <StreamingMarkdown content={entry.text} /> : null}
    </div>
  )
})
