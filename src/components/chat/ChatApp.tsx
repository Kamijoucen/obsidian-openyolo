import { useCallback, useEffect, useRef, useState } from 'react'

import { useSessionService } from '../../contexts/service-context'
import type { AvailabilityState } from '../../core/acp/service'
import type { HistorySessionInfo } from '../../types/chat'

import HeaderBar from './HeaderBar'
import SessionPanel from './SessionPanel'
import SetupBanner from './SetupBanner'

type ChatAppProps = {
  onOpenSettings: () => void
}

export default function ChatApp({ onOpenSettings }: ChatAppProps) {
  const service = useSessionService()
  const [tabId, setTabId] = useState<string | null>(null)
  const activeTabRef = useRef<string | null>(null)
  const targetSessionRef = useRef<string | null>(null)
  const switchSequenceRef = useRef(0)
  const mountedRef = useRef(true)
  const [availability, setAvailability] = useState<AvailabilityState>(() =>
    service.getAvailability(),
  )

  useEffect(() => {
    return service.onAvailabilityChange(setAvailability)
  }, [service])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      switchSequenceRef.current += 1
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const existing = service.listTabs()
    if (existing.length > 0) {
      if (!activeTabRef.current) {
        activeTabRef.current = existing[0].tabId
        targetSessionRef.current =
          service.getState(existing[0].tabId)?.sessionId ?? null
        setTabId(existing[0].tabId)
      }
      return
    }
    // Defer spawning opencode until after the current restore/paint cycle so
    // app startup isn't competing with the ACP subprocess boot.
    const timer = window.setTimeout(() => {
      const sequence = ++switchSequenceRef.current
      void service
        .openMostRecentTab()
        .then((id) => {
          if (cancelled) return
          if (sequence !== switchSequenceRef.current) {
            const sessionId = service.getState(id)?.sessionId ?? null
            if (
              id !== activeTabRef.current &&
              (sessionId === null || sessionId !== targetSessionRef.current)
            ) {
              void service.closeTab(id)
            }
            return
          }
          activeTabRef.current = id
          targetSessionRef.current = service.getState(id)?.sessionId ?? null
          setTabId(id)
        })
        .catch(() => {
          if (!cancelled && sequence === switchSequenceRef.current) {
            const id = service.createTab()
            activeTabRef.current = id
            targetSessionRef.current = null
            setTabId(id)
          }
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [service])

  const handleNew = useCallback(() => {
    switchSequenceRef.current += 1
    targetSessionRef.current = null
    const previous = activeTabRef.current
    const next = service.createTab()
    activeTabRef.current = next
    setTabId(next)
    if (previous && previous !== next) void service.closeTab(previous)
  }, [service])

  const handleOpenHistory = useCallback(
    (session: HistorySessionInfo) => {
      const sequence = ++switchSequenceRef.current
      targetSessionRef.current = session.sessionId
      void service
        .openHistoryTab(session.sessionId, session.title)
        .then((id) => {
          if (!mountedRef.current) return
          if (sequence !== switchSequenceRef.current) {
            const openedSessionId = service.getState(id)?.sessionId ?? null
            if (
              id !== activeTabRef.current &&
              (openedSessionId === null ||
                openedSessionId !== targetSessionRef.current)
            ) {
              void service.closeTab(id)
            }
            return
          }
          const previous = activeTabRef.current
          activeTabRef.current = id
          setTabId(id)
          if (previous && previous !== id) void service.closeTab(previous)
        })
        .catch(() => undefined)
    },
    [service],
  )

  return (
    <div className="yolo-chat-container yolo-chat-container--sidebar">
      <HeaderBar
        tabId={tabId}
        onNew={handleNew}
        onOpenHistory={handleOpenHistory}
      />
      <SetupBanner
        availability={availability}
        onOpenSettings={onOpenSettings}
      />
      {tabId ? <SessionPanel key={tabId} tabId={tabId} isActive /> : null}
    </div>
  )
}
