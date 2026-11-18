import { Notice } from 'obsidian'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useLanguage } from '../../contexts/language-context'
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
  const { t } = useLanguage()
  const [tabId, setTabId] = useState<string | null>(null)
  const [viewedChild, setViewedChild] = useState<string | null>(null)
  const [forking, setForking] = useState(false)
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

  const closeTabsExcept = useCallback(
    (activeTabId: string) => {
      for (const tab of service.listTabs()) {
        if (tab.tabId !== activeTabId) void service.closeInactiveTab(tab.tabId)
      }
    },
    [service],
  )

  const activateSingleTab = useCallback(
    (nextTabId: string, childSessionId: string | null = null) => {
      activeTabRef.current = nextTabId
      targetSessionRef.current =
        childSessionId ?? service.getState(nextTabId)?.sessionId ?? null
      setTabId(nextTabId)
      setViewedChild(childSessionId)
      closeTabsExcept(nextTabId)
    },
    [closeTabsExcept, service],
  )

  const closeStaleLoadedTab = useCallback(
    (
      loadedTabId: string,
      existingTabIds: ReadonlySet<string>,
      preserveLatestTarget = true,
    ) => {
      if (
        existingTabIds.has(loadedTabId) ||
        loadedTabId === activeTabRef.current
      ) {
        return
      }
      const loadedSessionId = service.getState(loadedTabId)?.sessionId ?? null
      if (
        preserveLatestTarget &&
        loadedSessionId !== null &&
        loadedSessionId === targetSessionRef.current
      ) {
        return
      }
      void service.closeInactiveTab(loadedTabId)
    },
    [service],
  )

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
      activateSingleTab(existing[0].tabId)
      return
    }
    // Defer spawning opencode until after the current paint cycle so
    // app startup isn't competing with the ACP subprocess boot.
    const timer = window.setTimeout(() => {
      const sequence = ++switchSequenceRef.current
      const existingTabIds = new Set(service.listTabs().map((tab) => tab.tabId))
      void service
        .openMostRecentTab()
        .then((id) => {
          if (cancelled) {
            closeStaleLoadedTab(id, existingTabIds, false)
            return
          }
          if (sequence !== switchSequenceRef.current) {
            closeStaleLoadedTab(id, existingTabIds)
            return
          }
          activateSingleTab(id)
        })
        .catch(() => {
          if (
            !cancelled &&
            sequence === switchSequenceRef.current &&
            activeTabRef.current === null
          ) {
            activateSingleTab(service.createTab())
          }
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activateSingleTab, closeStaleLoadedTab, service])

  const handleNew = useCallback(() => {
    switchSequenceRef.current += 1
    targetSessionRef.current = null
    activateSingleTab(service.createTab())
  }, [activateSingleTab, service])

  const handleOpenHistory = useCallback(
    (session: HistorySessionInfo) => {
      const sequence = ++switchSequenceRef.current
      targetSessionRef.current = session.sessionId
      const existingTabIds = new Set(service.listTabs().map((tab) => tab.tabId))
      void service
        .openHistoryTab(session.sessionId, session.title)
        .then((id) => {
          const isSubagent =
            service.getSubagentState(id, session.sessionId) !== null
          if (!mountedRef.current) {
            if (!isSubagent) closeStaleLoadedTab(id, existingTabIds, false)
            return
          }
          if (sequence !== switchSequenceRef.current) {
            if (!isSubagent) closeStaleLoadedTab(id, existingTabIds)
            return
          }
          activateSingleTab(id, isSubagent ? session.sessionId : null)
        })
        .catch(() => {
          if (mountedRef.current && sequence === switchSequenceRef.current) {
            targetSessionRef.current = activeTabRef.current
              ? (service.getState(activeTabRef.current)?.sessionId ?? null)
              : null
            new Notice(
              t('chat.historyLoadFailed', 'Could not load chat history.'),
            )
          }
        })
    },
    [activateSingleTab, closeStaleLoadedTab, service, t],
  )

  const handleFork = useCallback(() => {
    if (!tabId || forking) return
    const sequence = ++switchSequenceRef.current
    const existingTabIds = new Set(service.listTabs().map((tab) => tab.tabId))
    setForking(true)
    void service
      .forkTab(tabId)
      .then((id) => {
        if (!mountedRef.current || sequence !== switchSequenceRef.current) {
          closeStaleLoadedTab(id, existingTabIds, false)
          return
        }
        activateSingleTab(id)
      })
      .catch(() => {
        if (mountedRef.current && sequence === switchSequenceRef.current)
          new Notice(t('chat.forkFailed'))
      })
      .finally(() => {
        if (mountedRef.current) setForking(false)
      })
  }, [activateSingleTab, closeStaleLoadedTab, forking, service, t, tabId])

  return (
    <div className="yolo-chat-container yolo-chat-container--sidebar">
      <HeaderBar
        tabId={tabId}
        onNew={handleNew}
        onOpenHistory={handleOpenHistory}
        onFork={handleFork}
        forking={forking}
      />
      <SetupBanner
        availability={availability}
        onOpenSettings={onOpenSettings}
      />
      {tabId ? (
        <SessionPanel
          key={tabId}
          tabId={tabId}
          viewedChild={viewedChild}
          onViewChild={setViewedChild}
        />
      ) : null}
    </div>
  )
}
