import type { ContentBlock } from '@agentclientprotocol/sdk'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { memo, useState } from 'react'

import { useLanguage } from '../../contexts/language-context'
import { useSettings } from '../../contexts/settings-context'
import type { ChatAssistantEntry, ChatUserEntry } from '../../types/chat'

import StreamingMarkdown from './StreamingMarkdown'

const EMBEDDED_TEXT_PREVIEW_LIMIT = 20_000

function NonTextContentBlockView({ block }: { block: ContentBlock }) {
  const { t } = useLanguage()
  switch (block.type) {
    case 'text':
      return null
    case 'image':
      return (
        <img
          className="yolo-acp-assistant-image"
          src={`data:${block.mimeType};base64,${block.data}`}
          alt={t('chat.attachedImage', 'Attached image')}
          loading="lazy"
        />
      )
    case 'audio':
      return (
        <audio
          className="yolo-acp-assistant-audio"
          controls
          src={`data:${block.mimeType};base64,${block.data}`}
          aria-label={t('chat.attachedAudio', 'Attached audio')}
        />
      )
    case 'resource_link':
      return (
        <span className="yolo-acp-user-link-chip" title={block.uri}>
          {block.title || block.name || block.uri}
        </span>
      )
    case 'resource': {
      const resource = block.resource
      if ('text' in resource) {
        const truncated = resource.text.length > EMBEDDED_TEXT_PREVIEW_LIMIT
        const preview = truncated
          ? resource.text.slice(0, EMBEDDED_TEXT_PREVIEW_LIMIT)
          : resource.text
        return (
          <details className="yolo-acp-assistant-resource">
            <summary>{resource.uri}</summary>
            <pre>{preview}</pre>
            {truncated ? (
              <div className="yolo-acp-history-empty">
                {t('chat.contentTruncated', 'Content preview truncated.')}
              </div>
            ) : null}
          </details>
        )
      }
      return (
        <span className="yolo-acp-user-link-chip" title={resource.uri}>
          {resource.uri}
        </span>
      )
    }
  }
}

export const UserEntryView = memo(function UserEntryView({
  entry,
}: {
  entry: ChatUserEntry
}) {
  const images = entry.blocks.filter((block) => block.type === 'image')
  const links = entry.blocks.filter(
    (block) => block.type === 'resource_link' || block.type === 'resource',
  )
  return (
    <div className="yolo-chat-messages-user">
      <div className="yolo-chat-user-input-wrapper--compact">
        <div className="yolo-chat-user-input-container">
          {entry.text ? (
            <div className="yolo-chat-user-input-editor">{entry.text}</div>
          ) : null}
          {links.length > 0 ? (
            <div className="yolo-acp-user-links">
              {links.map((block, index) => {
                if (block.type === 'resource_link') {
                  return (
                    <span key={index} className="yolo-acp-user-link-chip">
                      {block.name || block.uri}
                    </span>
                  )
                }
                if (block.type === 'resource') {
                  const uri = block.resource.uri
                  const tail = uri.split('/').pop() || uri
                  let label = tail
                  try {
                    label = decodeURIComponent(tail)
                  } catch {
                    // keep the raw tail when the URI is malformed
                  }
                  return (
                    <span key={index} className="yolo-acp-user-link-chip">
                      {label}
                    </span>
                  )
                }
                return null
              })}
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
  const nonTextBlocks = entry.blocks.filter((block) => block.type !== 'text')

  return (
    <div className="yolo-chat-messages-assistant">
      {showReasoning ? (
        <div className="yolo-assistant-message-metadata">
          <button
            type="button"
            className="yolo-assistant-message-metadata-toggle"
            aria-expanded={reasoningOpen}
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
      {nonTextBlocks.length > 0 ? (
        <div className="yolo-acp-assistant-content-blocks">
          {nonTextBlocks.map((block, index) => (
            <NonTextContentBlockView key={index} block={block} />
          ))}
        </div>
      ) : null}
    </div>
  )
})
