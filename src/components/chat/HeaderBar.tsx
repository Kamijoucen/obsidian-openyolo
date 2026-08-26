import { History, Plus } from 'lucide-react'
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

import { useLanguage } from '../../contexts/language-context'
import { useSessionService } from '../../contexts/service-context'
import type { HistorySessionInfo } from '../../types/chat'

function HistoryPopup({
  anchorRef,
  ariaLabel,
  children,
  id,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  ariaLabel: string
  children: React.ReactNode
  id: string
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
        maxWidth: 300,
        overflowY: 'auto',
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
  }, [anchorRef])
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
}: {
  onOpenHistory: (session: HistorySessionInfo) => void
}) {
  const service = useSessionService()
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<HistorySessionInfo[] | null>(null)
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
  }, [closePopup, open, service])

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
        >
          {sessions === null ? (
            <div className="yolo-acp-history-empty">
              {t('common.loading', 'Loading…')}
            </div>
          ) : historyError ? (
            <div className="yolo-acp-history-empty">
              {t('chat.historyLoadFailed', 'Could not load chat history.')}
            </div>
          ) : sessions.length === 0 ? (
            <div className="yolo-acp-history-empty">
              {t('chat.historyEmpty', 'No previous sessions')}
            </div>
          ) : (
            <div className="yolo-model-select-list">{sessionItems}</div>
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
}

function HeaderBar({ tabId, onNew, onOpenHistory }: HeaderBarProps) {
  const { t } = useLanguage()
  return (
    <div className="yolo-acp-header">
      <HeaderTitle tabId={tabId} />
      <div className="yolo-acp-header-actions">
        <HistoryDropdown onOpenHistory={onOpenHistory} />
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
