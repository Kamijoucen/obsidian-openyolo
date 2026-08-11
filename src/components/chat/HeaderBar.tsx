import { FileText, History, Plus } from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { useApp } from '../../contexts/app-context'
import { useLanguage } from '../../contexts/language-context'
import { useSessionService } from '../../contexts/service-context'
import { useSettings } from '../../contexts/settings-context'
import { listConversationLogs } from '../../core/chatLog'
import type { ConversationLogInfo } from '../../core/chatLog'
import type { HistorySessionInfo } from '../../types/chat'

function HistoryPopup({
  anchorRef,
  ariaLabel,
  children,
  id,
  wide = false,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  ariaLabel: string
  children: React.ReactNode
  id: string
  wide?: boolean
}) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const initialFocusAppliedRef = useRef(false)
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const ownerDocument = anchor.ownerDocument
    const ownerWindow = ownerDocument.defaultView
    if (!ownerWindow) return
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect()
      setStyle({
        position: 'fixed',
        top: `${rect.bottom + 4}px`,
        right: `${ownerWindow.innerWidth - rect.right}px`,
        maxHeight: 340,
        minWidth: 220,
        maxWidth: wide ? 520 : 300,
        overflowY: wide ? 'hidden' : 'auto',
        zIndex: 40,
      })
    }
    setPortalRoot(ownerDocument.body)
    updatePosition()
    ownerWindow.addEventListener('resize', updatePosition)
    ownerDocument.addEventListener('scroll', updatePosition, true)
    const observer = new ownerWindow.ResizeObserver(updatePosition)
    observer.observe(anchor)
    return () => {
      observer.disconnect()
      ownerWindow.removeEventListener('resize', updatePosition)
      ownerDocument.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, wide])
  useLayoutEffect(() => {
    if (!portalRoot) return
    const surface = surfaceRef.current
    if (!surface) return
    const firstAction = surface.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!initialFocusAppliedRef.current) {
      initialFocusAppliedRef.current = true
      ;(firstAction ?? surface).focus()
      return
    }
    if (surface.ownerDocument.activeElement === surface && firstAction) {
      firstAction.focus()
    }
  }, [children, portalRoot])
  if (!portalRoot) return null
  return createPortal(
    <div
      ref={surfaceRef}
      id={id}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      className="yolo-popover-surface yolo-popover-surface--default yolo-acp-history-popup"
      style={style}
    >
      {children}
    </div>,
    portalRoot,
  )
}

function HistoryDropdown({
  onOpenHistory,
  onRestoreFromNote,
}: {
  onOpenHistory: (session: HistorySessionInfo) => void
  onRestoreFromNote: (notePath: string) => void
}) {
  const service = useSessionService()
  const app = useApp()
  const { settings } = useSettings()
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<HistorySessionInfo[] | null>(null)
  const [notes, setNotes] = useState<ConversationLogInfo[]>([])
  const [historyError, setHistoryError] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupId = useId()
  const closePopup = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSessions(null)
    setNotes([])
    setHistoryError(false)
    service
      .listHistory()
      .then((list) => {
        if (!cancelled) setSessions(list)
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryError(true)
          setSessions([])
        }
      })
    listConversationLogs(app, settings.conversationLogFolder)
      .then((list) => {
        if (!cancelled) setNotes(list)
      })
      .catch(() => undefined)
    const ownerDocument = containerRef.current?.ownerDocument ?? document
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const targetElement = target.nodeType === 1 ? (target as Element) : null
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !targetElement?.closest('.yolo-acp-history-popup')
      ) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closePopup()
    }
    ownerDocument.addEventListener('mousedown', handleClickOutside)
    ownerDocument.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelled = true
      ownerDocument.removeEventListener('mousedown', handleClickOutside)
      ownerDocument.removeEventListener('keydown', handleKeyDown)
    }
  }, [app, closePopup, open, service, settings.conversationLogFolder])

  const noteItems = notes.map((note) => (
    <button
      key={note.path}
      type="button"
      className="yolo-popover-item"
      onClick={() => {
        closePopup()
        onRestoreFromNote(note.path)
      }}
    >
      <span className="yolo-popover-item__label">
        <FileText size={14} /> {note.name}
      </span>
      <span className="yolo-acp-history-date">
        {new Date(note.mtime).toLocaleDateString()}
      </span>
    </button>
  ))

  const sessionItems = (sessions ?? []).map((session) => (
    <button
      key={session.sessionId}
      type="button"
      className="yolo-popover-item"
      onClick={() => {
        closePopup()
        onOpenHistory(session)
      }}
    >
      <span className="yolo-popover-item__label">
        {session.title || t('chat.untitled', 'New chat')}
      </span>
      {session.updatedAt ? (
        <span className="yolo-acp-history-date">
          {new Date(session.updatedAt).toLocaleDateString()}
        </span>
      ) : null}
    </button>
  ))

  const twoColumns =
    notes.length > 0 &&
    sessions !== null &&
    !historyError &&
    sessions.length > 0

  return (
    <div className="yolo-acp-history" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="clickable-icon"
        title={t('chat.history', 'History')}
        aria-label={t('chat.history', 'History')}
        aria-haspopup="dialog"
        aria-controls={open ? popupId : undefined}
        aria-expanded={open}
        onClick={() => (open ? closePopup() : setOpen(true))}
      >
        <History size={16} />
      </button>
      {open ? (
        <HistoryPopup
          anchorRef={containerRef}
          ariaLabel={t('chat.history', 'History')}
          id={popupId}
          wide={twoColumns}
        >
          {twoColumns ? (
            <div className="yolo-acp-history-columns">
              <div className="yolo-acp-history-column">
                <div className="yolo-acp-history-section">
                  {t('chat.noteHistorySection')}
                </div>
                <div className="yolo-model-select-list yolo-acp-history-list">
                  {noteItems}
                </div>
              </div>
              <div className="yolo-acp-history-column">
                <div className="yolo-acp-history-section">
                  {t('chat.sessionHistorySection')}
                </div>
                <div className="yolo-model-select-list yolo-acp-history-list">
                  {sessionItems}
                </div>
              </div>
            </div>
          ) : (
            <>
              {noteItems.length > 0 ? (
                <div className="yolo-model-select-list">{noteItems}</div>
              ) : null}
              {sessions === null ? (
                <div className="yolo-acp-history-empty">
                  {t('common.loading', 'Loading…')}
                </div>
              ) : historyError ? (
                <div className="yolo-acp-history-empty">
                  {t('chat.historyLoadFailed', 'Could not load chat history.')}
                </div>
              ) : sessions.length === 0 && noteItems.length === 0 ? (
                <div className="yolo-acp-history-empty">
                  {t('chat.historyEmpty', 'No previous sessions')}
                </div>
              ) : sessionItems.length === 0 ? null : (
                <div className="yolo-model-select-list">{sessionItems}</div>
              )}
            </>
          )}
        </HistoryPopup>
      ) : null}
    </div>
  )
}

function HeaderTitle({ tabId }: { tabId: string | null }) {
  const service = useSessionService()
  const { t } = useLanguage()
  const [title, setTitle] = useState(() =>
    tabId ? service.getTitle(tabId) : '',
  )
  useEffect(() => {
    if (!tabId) return
    setTitle(service.getTitle(tabId))
    return service.subscribe(tabId, (state) => {
      setTitle(state.title)
    })
  }, [service, tabId])
  return (
    <span className="yolo-acp-header-title">
      {title || t('chat.untitled', 'New chat')}
    </span>
  )
}

type HeaderBarProps = {
  tabId: string | null
  onNew: () => void
  onOpenHistory: (session: HistorySessionInfo) => void
  onRestoreFromNote: (notePath: string) => void
}

function HeaderBar({
  tabId,
  onNew,
  onOpenHistory,
  onRestoreFromNote,
}: HeaderBarProps) {
  const { t } = useLanguage()
  return (
    <div className="yolo-acp-header">
      <HeaderTitle tabId={tabId} />
      <div className="yolo-acp-header-actions">
        <HistoryDropdown
          onOpenHistory={onOpenHistory}
          onRestoreFromNote={onRestoreFromNote}
        />
        <button
          type="button"
          className="clickable-icon"
          title={t('chat.newChat', 'New chat')}
          aria-label={t('chat.newChat', 'New chat')}
          onClick={onNew}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  )
}

export default memo(HeaderBar)
