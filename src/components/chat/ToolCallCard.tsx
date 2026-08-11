import type {
  PermissionOption,
  ToolCallContent,
} from '@agentclientprotocol/sdk'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Loader2,
  X,
} from 'lucide-react'
import { memo, useState } from 'react'

import { useLanguage } from '../../contexts/language-context'
import {
  getSubagentToolDetails,
  isSubagentRawOutputContent,
} from '../../core/toolCallDetails'
import type { ToolCallState } from '../../types/chat'

import DiffView from './DiffView'

const TEXT_PREVIEW_LIMIT = 4000

function StatusIcon({ status }: { status: ToolCallState['status'] }) {
  switch (status) {
    case 'in_progress':
      return <Loader2 size={13} className="yolo-spinner" />
    case 'completed':
      return (
        <span className="yolo-toolcall-status-success-ring">
          <Check size={9} className="yolo-toolcall-status-success-check" />
        </span>
      )
    case 'failed':
      return (
        <span className="yolo-acp-status-failed">
          <X size={11} />
        </span>
      )
    default:
      return <span className="yolo-toolcall-status-dot" />
  }
}

function permissionButtonClass(kind: PermissionOption['kind']) {
  if (kind === 'allow_once' || kind === 'allow_always') {
    return 'yolo-acp-permission-button is-allow'
  }
  return 'yolo-acp-permission-button is-reject'
}

function ToolContentItem({ content }: { content: ToolCallContent }) {
  if (content.type === 'diff') {
    return (
      <DiffView
        path={content.path}
        oldText={content.oldText ?? ''}
        newText={content.newText}
      />
    )
  }
  if (content.type === 'terminal') {
    return (
      <pre className="yolo-acp-tool-text">
        <code>{content.terminalId}</code>
      </pre>
    )
  }
  const inner = content.content
  if (inner.type === 'text') {
    return (
      <pre className="yolo-acp-tool-text">
        <code>{textPreview(inner.text)}</code>
      </pre>
    )
  }
  if (inner.type === 'image') {
    return (
      <img
        className="yolo-acp-tool-image"
        src={`data:${inner.mimeType};base64,${inner.data}`}
        alt=""
      />
    )
  }
  if (inner.type === 'resource_link') {
    return <div className="yolo-acp-tool-text">{inner.uri}</div>
  }
  return null
}

function textPreview(text: string): string {
  return text.length > TEXT_PREVIEW_LIMIT
    ? `${text.slice(0, TEXT_PREVIEW_LIMIT)}\n…`
    : text
}

type ToolCallCardProps = {
  toolCall: ToolCallState
  onPermissionRespond: (toolCallId: string, optionId: string) => void
}

function ToolCallCard({ toolCall, onPermissionRespond }: ToolCallCardProps) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const subagent = getSubagentToolDetails(toolCall)
  const visibleContent = subagent
    ? toolCall.content.filter(
        (content) => !isSubagentRawOutputContent(content, subagent),
      )
    : toolCall.content
  const hasBody =
    visibleContent.length > 0 ||
    toolCall.locations.length > 0 ||
    subagent !== null
  const title = toolCall.title || toolCall.kind

  return (
    <div className="yolo-toolcall-container">
      <div className="yolo-toolcall">
        <button
          type="button"
          className="yolo-toolcall-header"
          aria-expanded={hasBody ? expanded : undefined}
          onClick={() => hasBody && setExpanded(!expanded)}
        >
          <span className="yolo-toolcall-header-icon yolo-toolcall-header-icon--status-inline">
            <StatusIcon status={toolCall.status} />
          </span>
          <span className="yolo-toolcall-header-content">
            <div className="yolo-toolcall-header-tool-name">
              <span className="yolo-toolcall-header-title" title={title}>
                {title}
              </span>
            </div>
          </span>
          {hasBody ? (
            <span className="yolo-toolcall-header-icon yolo-toolcall-header-icon--expand">
              {expanded ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )}
            </span>
          ) : null}
        </button>
        {toolCall.permission ? (
          <div className="yolo-acp-permission">
            <div className="yolo-acp-permission-title">
              <CircleAlert size={12} />
              {t('chat.permissionTitle', 'Permission required')}
            </div>
            <div className="yolo-acp-permission-actions">
              {toolCall.permission.options.map((option) => (
                <button
                  key={option.optionId}
                  type="button"
                  className={permissionButtonClass(option.kind)}
                  onClick={() =>
                    onPermissionRespond(toolCall.toolCallId, option.optionId)
                  }
                >
                  {option.name ||
                    (option.kind === 'allow_once'
                      ? t('chat.allowOnce', 'Allow once')
                      : option.kind === 'allow_always'
                        ? t('chat.allowAlways', 'Always allow')
                        : t('chat.reject', 'Reject'))}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {expanded && hasBody ? (
          <div className="yolo-toolcall-content">
            {toolCall.locations.length > 0 ? (
              <div className="yolo-acp-tool-locations">
                {toolCall.locations.map((location, index) => (
                  <span
                    key={`${location.path}-${index}`}
                    className="yolo-acp-tool-location"
                  >
                    {location.path}
                    {location.line != null ? `:${location.line}` : ''}
                  </span>
                ))}
              </div>
            ) : null}
            {subagent?.state === 'running' ? (
              <div className="yolo-acp-subagent-running" role="status">
                <Loader2
                  size={13}
                  className="yolo-spinner"
                  aria-hidden="true"
                />
                {t('chat.subagentRunning', 'Subagent is running.')}
              </div>
            ) : subagent?.output ? (
              <section className="yolo-acp-subagent-result">
                <div className="yolo-acp-subagent-result-title">
                  {t('chat.subagentOutput', 'Subagent output')}
                </div>
                <pre className="yolo-acp-tool-text">
                  <code>{subagent.output}</code>
                </pre>
              </section>
            ) : null}
            {visibleContent.map((content, index) => (
              <ToolContentItem key={index} content={content} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default memo(ToolCallCard)
