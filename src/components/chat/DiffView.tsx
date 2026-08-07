import { memo, useMemo } from 'react'

import { useLanguage } from '../../contexts/language-context'
import { createBoundedInlineDiff } from '../../utils/diff'

type DiffViewProps = {
  oldText: string
  newText: string
  path?: string
}

const MAX_LINES = 200

function DiffView({ oldText, newText, path }: DiffViewProps) {
  const { t } = useLanguage()
  const diff = useMemo(
    () => createBoundedInlineDiff(oldText, newText),
    [oldText, newText],
  )
  const { lines } = diff
  const truncated = lines.length > MAX_LINES
  const visible = truncated ? lines.slice(0, MAX_LINES) : lines

  return (
    <div className="yolo-diff">
      {path ? <div className="yolo-diff-path">{path}</div> : null}
      <pre className="yolo-diff-body">
        {visible.map((line, index) => (
          <div
            key={index}
            className={`yolo-diff-line yolo-diff-line--${line.type}`}
          >
            <span className="yolo-diff-sign">
              {line.type === 'added'
                ? '+'
                : line.type === 'removed'
                  ? '-'
                  : ' '}
            </span>
            <span className="yolo-diff-text">
              {line.tokens.map((token) => token.text).join('') || ' '}
            </span>
          </div>
        ))}
        {truncated ? (
          <div className="yolo-diff-line yolo-diff-line--unchanged">
            <span className="yolo-diff-sign">…</span>
            <span className="yolo-diff-text">
              {lines.length - MAX_LINES} more lines
            </span>
          </div>
        ) : null}
        {diff.inputTruncated ? (
          <div className="yolo-diff-line yolo-diff-line--unchanged">
            <span className="yolo-diff-sign">…</span>
            <span className="yolo-diff-text">
              {t('chat.diffPreviewTruncated', 'Diff preview truncated')}
            </span>
          </div>
        ) : null}
      </pre>
    </div>
  )
}

export default memo(DiffView)
