import { Notice } from 'obsidian'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { useLanguage } from '../../contexts/language-context'
import { useSessionService } from '../../contexts/service-context'
import type { AvailabilityState } from '../../core/acp/service'
import {
  buildRestoreBlocks,
  extractSessionId,
  vaultBasePath,
} from '../../core/chatLog'
import { recordSessionMapping } from '../../core/sessionMap'
import type { HistorySessionInfo } from '../../types/chat'

import HeaderBar from './HeaderBar'
import SessionPanel from './SessionPanel'
import SetupBanner from './SetupBanner'

type ChatAppProps = {
  onOpenSettings: () => void
}

export default function ChatApp({ onOpenSettings }: ChatAppProps) {
  const service = useSessionService()
  const app = useApp()
  const { t } = useLanguage()
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

  const closeTabsExcept = useCallback(
    (activeTabId: string) => {
      for (const tab of service.listTabs()) {
        if (tab.tabId !== activeTabId) void service.closeTab(tab.tabId)
      }
    },
    [service],
  )

  const activateSingleTab = useCallback(
    (nextTabId: string) => {
      activeTabRef.current = nextTabId
      targetSessionRef.current = service.getState(nextTabId)?.sessionId ?? null
      setTabId(nextTabId)
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
      void service.closeTab(loadedTabId)
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
    // Defer spawning opencode until after the current restore/paint cycle so
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

  const handleRestoreFromNote = useCallback(
    (notePath: string) => {
      switchSequenceRef.current += 1
      targetSessionRef.current = null
      const restoreText = t('chat.restorePrompt')
      void (async () => {
        let noteText: string
        try {
          noteText = await app.vault.adapter.read(notePath)
        } catch {
          if (mountedRef.current) new Notice(t('chat.restoreFailed'))
          return
        }
        if (!mountedRef.current) return
        const blocks = buildRestoreBlocks(
          restoreText,
          noteText,
          notePath,
          vaultBasePath(app),
        )
        const id = service.createTab()
        activateSingleTab(id)
        let result: string
        try {
          result = await service.submit(id, restoreText, blocks)
        } catch {
          result = 'failed'
        }
        if (result !== 'accepted') {
          if (mountedRef.current) new Notice(t('chat.restoreFailed'))
          return
        }
        const newSessionId = service.getState(id)?.sessionId
        const originalId = extractSessionId(noteText)
        if (newSessionId && originalId && newSessionId !== originalId) {
          try {
            await recordSessionMapping(vaultBasePath(app), newSessionId, {
              id: originalId,
              path: notePath,
            })
          } catch (error) {
            console.warn('[openyolo] failed to record session mapping', error)
          }
        }
      })()
    },
    [activateSingleTab, app, service, t],
  )

  const handleOpenHistory = useCallback(
    (session: HistorySessionInfo) => {
      const sequence = ++switchSequenceRef.current
      targetSessionRef.current = session.sessionId
      const existingTabIds = new Set(service.listTabs().map((tab) => tab.tabId))
      void service
        .openHistoryTab(session.sessionId, session.title)
        .then((id) => {
          if (!mountedRef.current) {
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

  return (
    <div className="yolo-chat-container yolo-chat-container--sidebar">
      <HeaderBar
        tabId={tabId}
        onNew={handleNew}
        onOpenHistory={handleOpenHistory}
        onRestoreFromNote={handleRestoreFromNote}
      />
      <SetupBanner
        availability={availability}
        onOpenSettings={onOpenSettings}
      />
      {tabId ? <SessionPanel key={tabId} tabId={tabId} /> : null}
    </div>
  )
}
