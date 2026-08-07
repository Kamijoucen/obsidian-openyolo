import type {
  AgentCapabilities,
  ContentBlock,
  Implementation,
  ListSessionsResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  ResumeSessionResponse,
  SendRequestOptions,
  SessionConfigOption,
  SessionMode,
  SessionNotification,
  SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk'
import type { App } from 'obsidian'

import type { YoloSettings } from '../../settings/schema/setting.types'
import type { ChatSessionState, HistorySessionInfo } from '../../types/chat'

import { AcpClient, AcpTimeoutError, OpencodeNotFoundError } from './client'
import type {
  AcpClientFactory,
  AcpClientPort,
  AcpDisconnectReason,
} from './client'
import { sanitizeDebugPayload } from './debug'
import { FsBridge } from './fsBridge'
import { SessionStateStore } from './mapper'
import { PermissionManager } from './permissions'
import { cancelTimeout, scheduleTimeout } from './timers'
import type { TimerHandle } from './timers'

type ChatTabInfo = {
  tabId: string
}

export type AvailabilityState = 'unknown' | 'starting' | 'ready' | 'unavailable'

export type SubmitResult = 'accepted' | 'busy' | 'failed'

const CONTROL_REQUEST_TIMEOUT_MS = 60_000
const CANCEL_GRACE_MS = 15_000

let tabSeq = 0
function nextTabId(): string {
  tabSeq += 1
  return `tab_${Date.now().toString(36)}_${tabSeq}`
}

type TabRecord = {
  tabId: string
  store: SessionStateStore
  sessionId: string | null
  desiredMode: string | null
  controlMutationTail: Promise<void>
  modeMutationRevision: number
  configMutationRevisions: Map<string, number>
  controlError: string | null
  sessionPromise: Promise<string> | null
  attachedGeneration: number | null
  activeTurn: TurnRecord | null
  loadController: AbortController | null
  loadGeneration: number | null
  closed: boolean
}

type TurnRecord = {
  id: number
  phase: 'preparing' | 'running' | 'cancelling'
  cancelRequested: boolean
  cancelTimer: TimerHandle | null
  connectionGeneration: number | null
  promptStarted: boolean
  settled: Promise<void>
  resolveSettled: () => void
}

type SessionSetupResponse = Pick<NewSessionResponse, 'configOptions' | 'modes'>

let turnSeq = 0
function nextTurnId(): number {
  turnSeq += 1
  return turnSeq
}

function createTurn(): TurnRecord {
  let resolveSettled: () => void = () => undefined
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve
  })
  return {
    id: nextTurnId(),
    phase: 'preparing',
    cancelRequested: false,
    cancelTimer: null,
    connectionGeneration: null,
    promptStarted: false,
    settled,
    resolveSettled,
  }
}

function isAuthError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const record = error as { code?: unknown; message?: unknown }
  if (record.code === -32000) return true
  return (
    typeof record.message === 'string' &&
    /auth|login|unauthorized/i.test(record.message)
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

function modesFromConfigOptions(
  configOptions: SessionConfigOption[] | null | undefined,
): { current: string; available: SessionMode[] } | null {
  const modeOption = configOptions?.find(
    (option) => option.category === 'mode' || option.id === 'mode',
  )
  if (!modeOption || modeOption.type !== 'select') return null
  const available: SessionMode[] = []
  for (const item of modeOption.options) {
    if ('options' in item) {
      for (const child of item.options) {
        available.push({ id: child.value, name: child.name })
      }
    } else {
      available.push({ id: item.value, name: item.name })
    }
  }
  if (available.length === 0) return null
  return { current: modeOption.currentValue, available }
}

function isUntitledSessionTitle(title: string | null | undefined): boolean {
  if (!title) return true
  // opencode's default title for sessions that never received a prompt.
  return /^new session( -|$)/i.test(title.trim())
}

function flatSelectValues(option: SessionConfigOption): string[] {
  if (option.type !== 'select') return []
  const values: string[] = []
  for (const item of option.options) {
    if ('options' in item) {
      for (const child of item.options) values.push(child.value)
    } else {
      values.push(item.value)
    }
  }
  return values
}

export class AcpSessionService {
  private client: AcpClientPort | null = null
  private startingClient: AcpClientPort | null = null
  private startPromise: Promise<void> | null = null
  private connectionGeneration = 0
  private activeGeneration = 0
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private restartPromise: Promise<void> | null = null
  private clientTeardown: Promise<void> = Promise.resolve()
  private availability: AvailabilityState = 'unknown'
  private startError: string | null = null
  private tabs = new Map<string, TabRecord>()
  private tabBySession = new Map<string, string>()
  private openingBySession = new Map<string, Promise<string>>()
  private closingBySession = new Map<string, Promise<void>>()
  private remoteCloseBySession = new Map<string, Promise<void>>()
  private closingTurns = new Set<TurnRecord>()
  private permissionManager: PermissionManager
  private availabilityListeners = new Set<(state: AvailabilityState) => void>()
  private activityListeners = new Set<() => void>()
  private lastConfigOptions: SessionConfigOption[] = []
  private eagerProbeStarted = false
  private eagerProbePromise: Promise<void> | null = null

  constructor(
    private readonly app: App,
    private readonly getSettings: () => YoloSettings,
    private readonly clientVersion: string,
    private readonly persistConfigSelection: (
      configId: string,
      value: string,
    ) => void = () => undefined,
    private readonly createClient: AcpClientFactory = (options) =>
      new AcpClient(options),
  ) {
    this.permissionManager = new PermissionManager(
      () => this.getSettings().autoApprovePermissions,
    )
  }

  private setLastConfigOptions(options: SessionConfigOption[]) {
    this.lastConfigOptions = options
  }

  private vaultCwd(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string }
    if (typeof adapter.getBasePath !== 'function') {
      throw new Error('Vault base path is unavailable on this platform')
    }
    return adapter.getBasePath()
  }

  getAvailability(): AvailabilityState {
    return this.availability
  }

  getStartError(): string | null {
    return this.startError
  }

  getAgentInfo(): Implementation | null {
    return this.client?.agentInfo ?? null
  }

  getAgentCapabilities(): AgentCapabilities {
    return this.client?.agentCapabilities ?? {}
  }

  onAvailabilityChange(
    listener: (state: AvailabilityState) => void,
  ): () => void {
    this.availabilityListeners.add(listener)
    return () => {
      this.availabilityListeners.delete(listener)
    }
  }

  private setAvailability(
    state: AvailabilityState,
    error: string | null = null,
  ) {
    if (this.disposed) return
    this.availability = state
    this.startError = error
    for (const listener of this.availabilityListeners) listener(state)
  }

  async ensureStarted(): Promise<void> {
    if (this.disposed) throw new Error('ACP session service is disposed')
    if (this.restartPromise) return this.restartPromise
    if (this.client?.isConnected) {
      this.setAvailability('ready')
      return
    }
    if (this.startPromise) return this.startPromise
    const promise = this.start()
    this.startPromise = promise
    try {
      await promise
    } finally {
      if (this.startPromise === promise) this.startPromise = null
    }
  }

  /**
   * Replaces the ACP process using the latest settings while retaining open
   * tabs and their remote session ids. In-flight turns are failed explicitly;
   * a later operation will resume each retained session on the new client.
   */
  async restart(): Promise<void> {
    if (this.disposed) throw new Error('ACP session service is disposed')
    if (this.restartPromise) {
      await this.restartPromise
      if (this.eagerProbePromise) await this.eagerProbePromise
      return
    }
    const restarting = Promise.resolve().then(() => this.restartInternal())
    this.restartPromise = restarting
    try {
      await restarting
    } finally {
      if (this.restartPromise === restarting) this.restartPromise = null
    }
    await this.retryEagerProbe()
  }

  private async restartInternal(): Promise<void> {
    const restartError = new Error('ACP connection restarted')
    this.setAvailability('starting')
    this.connectionGeneration += 1
    this.activeGeneration = 0
    this.permissionManager.cancelAll()

    for (const tab of this.tabs.values()) {
      tab.attachedGeneration = null
      tab.sessionPromise = null
      tab.loadController?.abort(restartError)
      const turn = tab.activeTurn
      if (turn) this.failTurn(tab, turn, restartError)
    }
    for (const turn of this.closingTurns) {
      this.clearTurnTimer(turn)
      turn.resolveSettled()
    }
    this.closingTurns.clear()
    this.remoteCloseBySession.clear()

    const clients = new Set(
      [this.client, this.startingClient].filter(
        (client): client is AcpClientPort => client !== null,
      ),
    )
    this.client = null
    this.startingClient = null
    // A superseded connect is guarded by its connection generation. Do not
    // let a non-cooperative client implementation keep this restart blocked.
    this.startPromise = null
    for (const client of clients) {
      void this.trackClientDisposal(client, restartError)
    }
    await this.clientTeardown
    if (this.disposed) {
      throw new Error('ACP session service was disposed while restarting')
    }

    const starting = this.start()
    this.startPromise = starting
    try {
      await starting
    } finally {
      if (this.startPromise === starting) this.startPromise = null
    }
  }

  private async start(): Promise<void> {
    this.setAvailability('starting')
    await this.clientTeardown
    if (this.disposed) {
      throw new Error('ACP session service was disposed while starting')
    }
    const staleClient = this.client
    if (staleClient && !staleClient.isConnected) {
      this.client = null
      this.activeGeneration = 0
      this.connectionGeneration += 1
      await this.trackClientDisposal(
        staleClient,
        new Error('Replacing closed ACP connection'),
      )
      if (this.disposed) {
        throw new Error('ACP session service was disposed while starting')
      }
    }
    const settings = this.getSettings()
    const generation = ++this.connectionGeneration
    const client = this.createClient({
      configuredPath: settings.opencodePath,
      extraArgs: settings.opencodeArgs,
      cwd: this.vaultCwd(),
      clientName: 'openyolo',
      clientVersion: this.clientVersion,
    })
    this.startingClient = client
    const fsBridge = new FsBridge(this.app)
    try {
      await client.connect({
        fsBridge,
        permissionManager: this.permissionManager,
        isSessionActive: (sessionId) =>
          this.isCurrentClient(client, generation) &&
          this.tabBySession.has(sessionId),
        canRequestPermission: (params) => {
          if (!this.isCurrentClient(client, generation)) return false
          const tabId = this.tabBySession.get(params.sessionId)
          const turn = tabId ? this.tabs.get(tabId)?.activeTurn : null
          return turn != null && !turn.cancelRequested
        },
        onSessionUpdate: (notification) => {
          if (!this.isCurrentClient(client, generation)) return
          this.handleSessionUpdate(notification)
        },
        onPermissionPending: (params) => {
          if (!this.isCurrentClient(client, generation)) return
          this.debug('session/request_permission', params)
          const tabId = this.tabBySession.get(params.sessionId)
          const tab = tabId ? this.tabs.get(tabId) : null
          tab?.store.setPendingPermission(params.toolCall, params.options)
        },
        onPermissionSettled: (sessionId, toolCallId) => {
          if (!this.isCurrentClient(client, generation)) return
          this.debug('permission settled', { sessionId, toolCallId })
          const tabId = this.tabBySession.get(sessionId)
          if (tabId)
            this.tabs.get(tabId)?.store.clearPendingPermission(toolCallId)
        },
        onStderr: (line) => {
          this.debug('stderr', line)
        },
        onDebug: (event, payload) => {
          this.debug(event, payload)
        },
        onDisconnected: (reason) => {
          this.handleDisconnected(client, generation, reason)
        },
      })
      if (this.disposed || this.connectionGeneration !== generation) {
        throw new Error('ACP session service was disposed while starting')
      }
      if (!client.isConnected) {
        throw new Error('ACP connection closed while starting')
      }
    } catch (error) {
      await this.trackClientDisposal(client, error)
      if (this.startingClient === client) this.startingClient = null
      if (!this.disposed && this.connectionGeneration === generation) {
        if (error instanceof OpencodeNotFoundError) {
          this.setAvailability('unavailable', 'opencode-not-found')
        } else {
          this.setAvailability('unavailable', errorMessage(error))
        }
      }
      throw error
    }
    this.startingClient = null
    this.client = client
    this.activeGeneration = generation
    this.setAvailability('ready')
  }

  private isCurrentClient(client: AcpClientPort, generation: number): boolean {
    return (
      !this.disposed &&
      this.connectionGeneration === generation &&
      (this.client === client || this.startingClient === client)
    )
  }

  private trackClientDisposal(
    client: AcpClientPort,
    reason?: unknown,
  ): Promise<void> {
    const previousTeardown = this.clientTeardown
    let releaseTeardown: () => void = () => undefined
    const teardownGate = new Promise<void>((resolve) => {
      releaseTeardown = resolve
    })
    this.clientTeardown = Promise.all([previousTeardown, teardownGate]).then(
      () => undefined,
    )

    let disposal: Promise<void>
    try {
      disposal = client.dispose(reason)
    } catch {
      disposal = Promise.resolve()
    }
    const settled = disposal.catch(() => undefined)
    void settled.then(releaseTeardown)
    return settled
  }

  private handleDisconnected(
    client: AcpClientPort,
    generation: number,
    disconnect: AcpDisconnectReason,
  ) {
    if (
      this.disposed ||
      this.client !== client ||
      this.activeGeneration !== generation ||
      this.connectionGeneration !== generation
    ) {
      return
    }
    const reason =
      disconnect.kind === 'process-exit'
        ? `opencode exited (code=${disconnect.code ?? 'null'} signal=${
            disconnect.signal ?? 'null'
          })`
        : errorMessage(disconnect.error)
    void this.trackClientDisposal(client, disconnect)
    this.permissionManager.cancelAll()
    this.client = null
    this.activeGeneration = 0
    this.connectionGeneration += 1
    for (const tab of this.tabs.values()) {
      tab.attachedGeneration = null
      tab.sessionPromise = null
      const turn = tab.activeTurn
      const preserveUnboundTurn = turn?.connectionGeneration === null
      if (turn && !preserveUnboundTurn) {
        this.clearTurnTimer(turn)
        tab.activeTurn = null
        turn.resolveSettled()
      }
      if (
        !preserveUnboundTurn &&
        ['loading', 'preparing', 'running', 'cancelling'].includes(
          tab.store.getState().status,
        )
      ) {
        tab.store.markTurnEnd(null)
        tab.store.setStatus('error', reason)
      }
    }
    for (const turn of this.closingTurns) {
      if (turn.connectionGeneration !== generation) continue
      this.clearTurnTimer(turn)
      turn.resolveSettled()
    }
    this.setAvailability('unavailable', reason)
    this.emitActivity()
  }

  private handleSessionUpdate(notification: SessionNotification) {
    this.debug('session/update', notification)
    const tabId = this.tabBySession.get(notification.sessionId)
    if (!tabId) return
    const tab = this.tabs.get(tabId)
    if (!tab || tab.closed) return
    tab.store.applyUpdate(notification.update)
    if (notification.update.sessionUpdate === 'config_option_update') {
      this.setLastConfigOptions(notification.update.configOptions)
    }
    this.emitActivity()
  }

  onActivityChange(listener: () => void): () => void {
    this.activityListeners.add(listener)
    return () => {
      this.activityListeners.delete(listener)
    }
  }

  private emitActivity() {
    for (const listener of this.activityListeners) listener()
  }

  getRunningCount(): number {
    let count = 0
    for (const tab of this.tabs.values()) {
      if (
        ['preparing', 'running', 'cancelling'].includes(
          tab.store.getState().status,
        )
      ) {
        count += 1
      }
    }
    return count
  }

  listTabs(): ChatTabInfo[] {
    return [...this.tabs.values()].map((tab) => ({
      tabId: tab.tabId,
    }))
  }

  getState(tabId: string): ChatSessionState | null {
    return this.tabs.get(tabId)?.store.getState() ?? null
  }

  getTitle(tabId: string): string {
    return this.tabs.get(tabId)?.store.getState().title ?? ''
  }

  subscribe(
    tabId: string,
    listener: (state: ChatSessionState) => void,
  ): () => void {
    const tab = this.tabs.get(tabId)
    if (!tab) return () => undefined
    return tab.store.subscribe(listener)
  }

  createTab(): string {
    const tabId = nextTabId()
    const store = new SessionStateStore('')
    const desiredMode = this.getSettings().defaultMode
    if (this.lastConfigOptions.length > 0) {
      store.applyConfigOptions(this.lastConfigOptions)
      const modes = modesFromConfigOptions(this.lastConfigOptions)
      if (modes) {
        store.applyModes(modes.current, modes.available)
      }
    }
    if (desiredMode) store.setModeCurrent(desiredMode)
    const tab: TabRecord = {
      tabId,
      store,
      sessionId: null,
      desiredMode,
      controlMutationTail: Promise.resolve(),
      modeMutationRevision: 0,
      configMutationRevisions: new Map(),
      controlError: null,
      sessionPromise: null,
      attachedGeneration: null,
      activeTurn: null,
      loadController: null,
      loadGeneration: null,
      closed: false,
    }
    this.tabs.set(tabId, tab)
    // Keep one probe in flight until a tab successfully populates model/effort
    // selectors. Later tabs reuse cached options and avoid persisting a trail
    // of empty remote sessions before the user sends anything.
    void this.startEagerProbe(tab)
    return tabId
  }

  private startEagerProbe(tab: TabRecord): Promise<void> {
    if (
      this.eagerProbeStarted ||
      this.lastConfigOptions.length > 0 ||
      tab.closed
    ) {
      return Promise.resolve()
    }
    if (this.eagerProbePromise) return this.eagerProbePromise

    const probing = (async () => {
      try {
        await this.ensureStarted()
        if (tab.closed || this.tabs.get(tab.tabId) !== tab) {
          return
        }
        await this.ensureSession(tab)
        this.eagerProbeStarted = true
      } catch {
        // A later tab creation or a successful backend restart may retry.
      }
    })()
    this.eagerProbePromise = probing
    return probing.finally(() => {
      if (this.eagerProbePromise === probing) this.eagerProbePromise = null
    })
  }

  private async retryEagerProbe(): Promise<void> {
    if (this.eagerProbePromise) await this.eagerProbePromise
    if (this.eagerProbeStarted || this.lastConfigOptions.length > 0) return
    const tab = [...this.tabs.values()].find((candidate) => !candidate.closed)
    if (tab) await this.startEagerProbe(tab)
  }

  /**
   * Opens the most recently updated history session, or creates a fresh tab
   * when there is no usable history (or opencode is unavailable).
   */
  async openMostRecentTab(): Promise<string> {
    try {
      const history = await this.listHistory()
      const mostRecent = history[0]
      if (mostRecent) {
        return await this.openHistoryTab(mostRecent.sessionId, mostRecent.title)
      }
    } catch {
      // fall through to a fresh tab
    }
    return this.listTabs()[0]?.tabId ?? this.createTab()
  }

  async openHistoryTab(sessionId: string, title: string): Promise<string> {
    const closing = this.closingBySession.get(sessionId)
    if (closing) await closing
    const existing = this.tabBySession.get(sessionId)
    if (existing && this.tabs.has(existing)) return existing
    const opening = this.openingBySession.get(sessionId)
    if (opening) return opening

    const promise = this.loadHistoryTab(sessionId, title)
    this.openingBySession.set(sessionId, promise)
    try {
      return await promise
    } finally {
      if (this.openingBySession.get(sessionId) === promise) {
        this.openingBySession.delete(sessionId)
      }
    }
  }

  private async loadHistoryTab(
    sessionId: string,
    title: string,
  ): Promise<string> {
    await this.ensureStarted()
    const generation = this.activeGeneration
    if (!this.supportsSessionListLoad('load')) {
      throw new Error('ACP agent does not support session/load')
    }
    const existing = this.tabBySession.get(sessionId)
    if (existing && this.tabs.has(existing)) return existing
    const tabId = nextTabId()
    const store = new SessionStateStore(title)
    const tab: TabRecord = {
      tabId,
      store,
      sessionId,
      desiredMode: null,
      controlMutationTail: Promise.resolve(),
      modeMutationRevision: 0,
      configMutationRevisions: new Map(),
      controlError: null,
      sessionPromise: null,
      attachedGeneration: null,
      activeTurn: null,
      loadController: null,
      loadGeneration: null,
      closed: false,
    }
    this.tabs.set(tabId, tab)
    this.tabBySession.set(sessionId, tabId)
    store.setSessionId(sessionId)
    store.setStatus('loading')
    const loadController = new AbortController()
    tab.loadController = loadController
    tab.loadGeneration = generation
    try {
      const response = await this.request<LoadSessionResponse>(
        'session/load',
        {
          sessionId,
          cwd: this.vaultCwd(),
          mcpServers: [],
        },
        { generation, signal: loadController.signal },
      )
      this.assertActiveGeneration(generation)
      if (tab.closed || this.tabBySession.get(sessionId) !== tabId) {
        throw new Error('Tab was closed while loading the session')
      }
      await this.applySessionSetup(tab, sessionId, response, generation)
      this.assertActiveGeneration(generation)
      await this.applyDesiredMode(tab, sessionId, response, generation)
      this.assertActiveGeneration(generation)
      tab.attachedGeneration = generation
      store.markTurnEnd(null)
    } catch (error) {
      const replacementGeneration = tab.activeTurn?.connectionGeneration
      const hasReplacement =
        (tab.attachedGeneration !== null &&
          tab.attachedGeneration !== generation) ||
        (replacementGeneration !== null &&
          replacementGeneration !== undefined &&
          replacementGeneration !== generation)
      if (!hasReplacement && !tab.closed && this.tabs.get(tabId) === tab) {
        tab.closed = true
        this.tabs.delete(tabId)
        if (this.tabBySession.get(sessionId) === tabId) {
          this.tabBySession.delete(sessionId)
          this.permissionManager.cancelSession(sessionId)
        }
        this.emitActivity()
      }
      throw error
    } finally {
      if (tab.loadController === loadController) {
        tab.loadController = null
        tab.loadGeneration = null
      }
    }
    this.emitActivity()
    if (tab.closed || this.tabs.get(tabId) !== tab) {
      throw new Error('Tab was closed while loading the session')
    }
    return tabId
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    const turn = tab.activeTurn
    const cancellation = turn ? this.cancel(tabId) : Promise.resolve()
    tab.closed = true
    const sessionId = tab.sessionId
    const opening = sessionId
      ? (this.openingBySession.get(sessionId) ?? null)
      : null
    const loadGeneration = tab.loadGeneration
    tab.loadController?.abort(new Error('Tab closed while loading'))
    if (
      sessionId &&
      opening &&
      this.openingBySession.get(sessionId) === opening
    ) {
      this.openingBySession.delete(sessionId)
    }
    this.tabs.delete(tabId)
    if (turn?.promptStarted) this.trackClosingTurn(turn)
    else if (turn) this.finishClosedTurn(tab, turn)

    let closing: Promise<void> | null = null
    let closingSessionId: string | null = null
    if (sessionId && this.tabBySession.get(sessionId) === tabId) {
      closingSessionId = sessionId
      this.tabBySession.delete(sessionId)
      this.permissionManager.cancelSession(sessionId)
      const remoteClose = (async () => {
        if (opening) {
          await this.containHistoryLoad(opening, loadGeneration)
        }
        await this.closeRemoteSession(sessionId)
      })()
      closing = Promise.allSettled([
        remoteClose,
        turn?.settled ?? Promise.resolve(),
      ]).then(() => undefined)
      this.closingBySession.set(sessionId, closing)
    }
    this.emitActivity()
    void cancellation
    if (closing && closingSessionId) {
      await closing
      if (this.closingBySession.get(closingSessionId) === closing) {
        this.closingBySession.delete(closingSessionId)
      }
    }
  }

  private async containHistoryLoad(
    opening: Promise<string>,
    generation: number | null,
  ): Promise<void> {
    let timer: TimerHandle | null = null
    await Promise.race([
      opening.then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = scheduleTimeout(() => {
          const client = this.client
          if (
            client &&
            generation !== null &&
            generation === this.activeGeneration
          ) {
            this.handleDisconnected(client, generation, {
              kind: 'connection-closed',
              error: new AcpTimeoutError('ACP history load cancellation'),
            })
          }
          resolve()
        }, CANCEL_GRACE_MS)
      }),
    ])
    if (timer !== null) cancelTimeout(timer)
  }

  async listHistory(): Promise<HistorySessionInfo[]> {
    await this.ensureStarted()
    const generation = this.activeGeneration
    if (!this.supportsSessionListLoad('list')) return []
    const sessions: HistorySessionInfo[] = []
    const seenCursors = new Set<string>()
    let cursor: string | null | undefined = null
    do {
      const response: ListSessionsResponse =
        await this.request<ListSessionsResponse>(
          'session/list',
          {
            cwd: this.vaultCwd(),
            cursor,
          },
          { generation },
        )
      for (const item of response.sessions) {
        // Sessions that never received a prompt are empty; hide them so
        // eagerly created sessions don't clutter the history list.
        if (isUntitledSessionTitle(item.title)) continue
        sessions.push({
          sessionId: item.sessionId,
          title: item.title as string,
          updatedAt: item.updatedAt ?? null,
        })
      }
      const nextCursor = response.nextCursor ?? null
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error('ACP session/list returned a repeated cursor')
      }
      if (nextCursor) seenCursors.add(nextCursor)
      cursor = nextCursor
    } while (cursor)
    sessions.sort((a, b) =>
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
    )
    return sessions
  }

  private async ensureSession(tab: TabRecord): Promise<string> {
    if (tab.closed) throw new Error('Tab is closed')
    if (tab.sessionPromise) return tab.sessionPromise
    if (
      tab.sessionId &&
      tab.attachedGeneration !== null &&
      tab.attachedGeneration === this.activeGeneration
    ) {
      return tab.sessionId
    }
    const promise = this.attachOrCreateSession(tab)
    tab.sessionPromise = promise
    try {
      return await promise
    } finally {
      if (tab.sessionPromise === promise) tab.sessionPromise = null
    }
  }

  private async attachOrCreateSession(tab: TabRecord): Promise<string> {
    await this.ensureStarted()
    if (tab.closed) throw new Error('Tab is closed')
    const generation = this.activeGeneration

    if (tab.sessionId) {
      const sessionId = tab.sessionId
      let response: ResumeSessionResponse | LoadSessionResponse
      if (this.supportsSessionCapability('resume')) {
        response = await this.request<ResumeSessionResponse>(
          'session/resume',
          {
            sessionId,
            cwd: this.vaultCwd(),
            mcpServers: [],
          },
          { generation },
        )
      } else if (this.supportsSessionListLoad('load')) {
        tab.store.resetForReplay(sessionId)
        response = await this.request<LoadSessionResponse>(
          'session/load',
          {
            sessionId,
            cwd: this.vaultCwd(),
            mcpServers: [],
          },
          { generation },
        )
      } else {
        throw new Error('ACP agent cannot resume this session')
      }
      this.assertActiveGeneration(generation)
      if (tab.closed) {
        if (!this.tabBySession.has(sessionId)) {
          await this.closeRemoteSession(sessionId)
        }
        throw new Error('Tab was closed while resuming the session')
      }
      await this.applySessionSetup(tab, sessionId, response, generation)
      this.assertActiveGeneration(generation)
      tab.attachedGeneration = generation
      if (tab.store.getState().status === 'loading') {
        if (tab.activeTurn) tab.store.markPreparing()
        else tab.store.markTurnEnd(null)
      }
      return sessionId
    }

    const response = await this.request<NewSessionResponse>(
      'session/new',
      {
        cwd: this.vaultCwd(),
        mcpServers: [],
      },
      { generation },
    )
    this.assertActiveGeneration(generation)
    if (tab.closed) {
      if (!this.tabBySession.has(response.sessionId)) {
        await this.closeRemoteSession(response.sessionId)
      }
      throw new Error('Tab was closed while creating the session')
    }
    const existingOwner = this.tabBySession.get(response.sessionId)
    if (existingOwner && existingOwner !== tab.tabId) {
      throw new Error(`ACP session is already open: ${response.sessionId}`)
    }
    tab.sessionId = response.sessionId
    this.tabBySession.set(response.sessionId, tab.tabId)
    tab.store.setSessionId(response.sessionId)
    await this.applySessionSetup(tab, response.sessionId, response, generation)
    this.assertActiveGeneration(generation)
    tab.attachedGeneration = generation
    await this.applyDesiredMode(tab, response.sessionId, response, generation)
    this.assertActiveGeneration(generation)
    return response.sessionId
  }

  private async applyDesiredMode(
    tab: TabRecord,
    sessionId: string,
    response: SessionSetupResponse,
    generation: number,
  ): Promise<void> {
    const desired = tab.desiredMode
    if (!desired) return
    const modes = modesFromConfigOptions(response.configOptions)
    const available = modes?.available ?? response.modes?.availableModes ?? []
    const current = modes?.current ?? response.modes?.currentModeId
    if (!available.some((mode) => mode.id === desired) || current === desired) {
      return
    }
    await this.request(
      'session/set_mode',
      { sessionId, modeId: desired },
      { generation },
    )
    tab.store.setModeCurrent(desired)
  }

  private async applySessionSetup(
    tab: TabRecord,
    sessionId: string,
    response: SessionSetupResponse,
    generation: number,
  ): Promise<void> {
    this.assertActiveGeneration(generation)
    const modes =
      modesFromConfigOptions(response.configOptions) ??
      (response.modes
        ? {
            current: response.modes.currentModeId,
            available: response.modes.availableModes,
          }
        : null)
    if (modes) {
      tab.store.applyModes(modes.current, modes.available)
    }
    if (response.configOptions) {
      tab.store.applyConfigOptions(response.configOptions)
      this.setLastConfigOptions(response.configOptions)
      await this.applyConfigSelections(
        tab,
        sessionId,
        response.configOptions,
        generation,
      )
    }
    this.assertActiveGeneration(generation)
  }

  private assertActiveGeneration(generation: number) {
    if (
      this.disposed ||
      generation === 0 ||
      generation !== this.activeGeneration ||
      !this.client?.isConnected
    ) {
      throw new Error('ACP connection changed during the operation')
    }
  }

  private supportsSessionCapability(capability: 'close' | 'resume'): boolean {
    return (
      this.client?.agentCapabilities.sessionCapabilities?.[capability] != null
    )
  }

  private supportsSessionListLoad(capability: 'list' | 'load'): boolean {
    if (capability === 'load') {
      return this.client?.agentCapabilities.loadSession === true
    }
    return this.client?.agentCapabilities.sessionCapabilities?.list != null
  }

  private async closeRemoteSession(sessionId: string): Promise<void> {
    if (!this.client?.isConnected || !this.supportsSessionCapability('close')) {
      return
    }
    const existing = this.remoteCloseBySession.get(sessionId)
    if (existing) return existing
    const closing = this.request('session/close', { sessionId }).then(
      () => undefined,
      () => undefined,
    )
    this.remoteCloseBySession.set(sessionId, closing)
    try {
      await closing
    } finally {
      if (this.remoteCloseBySession.get(sessionId) === closing) {
        this.remoteCloseBySession.delete(sessionId)
      }
    }
  }

  private debug(event: string, payload?: unknown) {
    if (!this.getSettings().debugLog) return
    console.debug(
      '[openyolo]',
      event,
      payload === undefined ? '' : sanitizeDebugPayload(event, payload),
    )
  }

  private async request<T>(
    method: string,
    params?: unknown,
    options: {
      timeoutMs?: number | null
      generation?: number
      signal?: AbortSignal
    } = {},
  ): Promise<T> {
    this.debug(`→ ${method}`, params)
    const client = this.client
    const generation = options.generation ?? this.activeGeneration
    if (!client || generation === 0) {
      throw new Error('ACP client is not connected')
    }
    this.assertActiveGeneration(generation)
    const timeoutMs =
      options.timeoutMs === undefined
        ? CONTROL_REQUEST_TIMEOUT_MS
        : options.timeoutMs
    const controller =
      timeoutMs === null && !options.signal ? null : new AbortController()
    const abortFromCaller = () => {
      controller?.abort(options.signal?.reason)
    }
    if (options.signal) {
      if (options.signal.aborted) abortFromCaller()
      else
        options.signal.addEventListener('abort', abortFromCaller, {
          once: true,
        })
    }
    let timer: TimerHandle | null = null
    try {
      const requestOptions: SendRequestOptions | undefined = controller
        ? { cancellationSignal: controller.signal }
        : undefined
      const pending = client.agent().request<T>(method, params, requestOptions)
      const response =
        timeoutMs === null
          ? await pending
          : await Promise.race([
              pending,
              new Promise<never>((_, reject) => {
                timer = scheduleTimeout(() => {
                  const error = new AcpTimeoutError(`ACP ${method}`)
                  controller?.abort(error)
                  reject(error)
                }, timeoutMs)
              }),
            ])
      this.assertActiveGeneration(generation)
      this.debug(`← ${method}`, response)
      return response
    } catch (error) {
      this.debug(`✕ ${method}`, errorMessage(error))
      throw error
    } finally {
      if (timer !== null) cancelTimeout(timer)
      options.signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  private async notify(
    method: string,
    params?: unknown,
    generation = this.activeGeneration,
  ): Promise<void> {
    this.debug(`→ ${method}`, params)
    this.assertActiveGeneration(generation)
    const client = this.client
    if (!client) throw new Error('ACP client is not connected')
    await client.agent().notify(method, params)
    this.assertActiveGeneration(generation)
  }

  /**
   * 计算会话应应用的 configOption 选择：使用用户持久化的选择；
   * 持久化值已从列表下架时回退到列表第一项。仅模型的回退会写回记录——
   * 思考强度等选项的可选值随模型而变,对当前模型无效不代表用户改了
   * 偏好,保留原值以便切回支持的模型时恢复。
   */
  private resolveConfigSelections(
    options: SessionConfigOption[],
  ): Array<{ configId: string; value: string }> {
    const selections: Array<{ configId: string; value: string }> = []
    const saved = this.getSettings().savedConfigSelections ?? {}
    for (const option of options) {
      if (option.type !== 'select') continue
      const values = flatSelectValues(option)
      if (values.length === 0) continue
      const savedValue = saved[option.id]
      if (savedValue === undefined) continue
      const desired = values.includes(savedValue) ? savedValue : values[0]
      if (desired !== savedValue && option.id === 'model') {
        this.persistConfigSelection(option.id, desired)
      }
      if (desired !== option.currentValue) {
        selections.push({ configId: option.id, value: desired })
      }
    }
    return selections
  }

  private async applyConfigSelections(
    tab: TabRecord,
    sessionId: string,
    options: SessionConfigOption[],
    generation = this.activeGeneration,
  ) {
    if (tab.closed) return
    let currentOptions = options
    const apply = async (selection: { configId: string; value: string }) => {
      if (tab.closed) return
      const res = await this.request<SetSessionConfigOptionResponse>(
        'session/set_config_option',
        {
          sessionId,
          configId: selection.configId,
          value: selection.value,
        },
        { generation },
      ).catch(() => {
        this.assertActiveGeneration(generation)
        return null
      })
      if (tab.closed) return
      if (res?.configOptions) {
        currentOptions = res.configOptions
        this.setLastConfigOptions(res.configOptions)
        tab.store.applyConfigOptions(res.configOptions)
      }
    }
    // 模型必须先应用:思考强度等选项的可选值随模型切换而变化,必须用
    // 切换后返回的 configOptions 再解析,否则强度会在默认模型的变体列表
    // 里被漏判/误判,并在模型切换时被 opencode 重置为首个变体。
    const modelSelection = this.resolveConfigSelections(currentOptions).find(
      (selection) => selection.configId === 'model',
    )
    if (modelSelection) {
      await apply(modelSelection)
    }
    for (const selection of this.resolveConfigSelections(currentOptions)) {
      if (selection.configId === 'model') continue
      await apply(selection)
    }
  }

  private friendlyError(error: unknown): string {
    if (isAuthError(error)) {
      return 'opencode-auth-required'
    }
    return errorMessage(error)
  }

  async submit(
    tabId: string,
    text: string,
    blocks: ContentBlock[],
  ): Promise<SubmitResult> {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.closed) return 'failed'
    if (text.trim().length === 0) return 'failed'
    if (tab.activeTurn) return 'busy'

    const turn = createTurn()
    tab.activeTurn = turn
    tab.store.markPreparing()
    this.emitActivity()
    try {
      await this.waitForClosingTurns()
      if (!this.isCurrentTurn(tab, turn)) {
        this.finishClosedTurn(tab, turn)
        return 'failed'
      }
      if (turn.cancelRequested) {
        this.completeTurn(tab, turn, null)
        return 'failed'
      }
      await this.ensureStarted()
      if (!this.isCurrentTurn(tab, turn)) {
        this.finishClosedTurn(tab, turn)
        return 'failed'
      }
      turn.connectionGeneration = this.activeGeneration
      if (turn.cancelRequested) {
        this.completeTurn(tab, turn, null)
        return 'failed'
      }
      if (
        blocks.some((block) => block.type === 'image') &&
        this.client?.agentCapabilities.promptCapabilities?.image !== true
      ) {
        throw new Error(
          'The connected ACP agent does not support image prompts',
        )
      }
      const sessionId = await this.ensureSession(tab)
      if (!this.isCurrentTurn(tab, turn)) {
        this.finishClosedTurn(tab, turn)
        return 'failed'
      }
      if (turn.cancelRequested) {
        this.completeTurn(tab, turn, null)
        return 'failed'
      }

      tab.store.appendLocalUserMessage(text, blocks)
      tab.store.markRunning()
      turn.phase = 'running'
      turn.promptStarted = true
      const prompt = this.request<PromptResponse>(
        'session/prompt',
        { sessionId, prompt: blocks },
        { timeoutMs: null, generation: turn.connectionGeneration },
      )
      void this.finishPrompt(tab, turn, prompt)
      this.emitActivity()
      return 'accepted'
    } catch (error) {
      if (this.isCurrentTurn(tab, turn)) {
        this.failTurn(tab, turn, error)
      } else {
        this.finishClosedTurn(tab, turn)
      }
      return 'failed'
    }
  }

  async cancel(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    const turn = tab?.activeTurn
    if (!tab || !turn || turn.cancelRequested) return
    turn.cancelRequested = true
    turn.phase = 'cancelling'
    tab.store.markCancelling()
    this.emitActivity()
    this.scheduleCancelGrace(tab, turn)

    if (
      !tab.sessionId ||
      !this.client?.isConnected ||
      turn.connectionGeneration !== this.activeGeneration
    ) {
      return
    }
    this.permissionManager.cancelSession(tab.sessionId)
    await this.notify(
      'session/cancel',
      { sessionId: tab.sessionId },
      turn.connectionGeneration,
    ).catch(() => undefined)
  }

  private async finishPrompt(
    tab: TabRecord,
    turn: TurnRecord,
    prompt: Promise<PromptResponse>,
  ) {
    try {
      const response = await prompt
      if (this.isCurrentTurn(tab, turn)) {
        this.completeTurn(tab, turn, response.stopReason ?? null)
      } else {
        this.finishClosedTurn(tab, turn)
      }
    } catch (error) {
      if (!this.isCurrentTurn(tab, turn)) {
        this.finishClosedTurn(tab, turn)
        return
      }
      const code =
        typeof error === 'object' && error !== null
          ? (error as { code?: unknown }).code
          : undefined
      if (turn.cancelRequested && code === -32800) {
        this.completeTurn(tab, turn, 'cancelled')
      } else {
        this.failTurn(tab, turn, error)
      }
    }
  }

  private isCurrentTurn(tab: TabRecord, turn: TurnRecord): boolean {
    return (
      !tab.closed && this.tabs.get(tab.tabId) === tab && tab.activeTurn === turn
    )
  }

  private completeTurn(
    tab: TabRecord,
    turn: TurnRecord,
    stopReason: ChatSessionState['lastStopReason'],
  ) {
    if (!this.isCurrentTurn(tab, turn)) return
    this.clearTurnTimer(turn)
    tab.activeTurn = null
    turn.resolveSettled()
    tab.store.markTurnEnd(stopReason)
    this.emitActivity()
  }

  private failTurn(tab: TabRecord, turn: TurnRecord, error: unknown) {
    if (!this.isCurrentTurn(tab, turn)) return
    this.clearTurnTimer(turn)
    tab.activeTurn = null
    turn.resolveSettled()
    tab.store.markTurnEnd(null)
    tab.store.setStatus('error', this.friendlyError(error))
    this.emitActivity()
  }

  private clearTurnTimer(turn: TurnRecord) {
    if (turn.cancelTimer !== null) {
      cancelTimeout(turn.cancelTimer)
      turn.cancelTimer = null
    }
  }

  private finishClosedTurn(tab: TabRecord, turn: TurnRecord) {
    if (tab.activeTurn !== turn) return
    this.clearTurnTimer(turn)
    tab.activeTurn = null
    turn.resolveSettled()
  }

  private trackClosingTurn(turn: TurnRecord) {
    this.closingTurns.add(turn)
    void turn.settled.then(() => {
      this.closingTurns.delete(turn)
    })
  }

  private async waitForClosingTurns(): Promise<void> {
    while (this.closingTurns.size > 0) {
      await Promise.all([...this.closingTurns].map((turn) => turn.settled))
    }
  }

  private scheduleCancelGrace(tab: TabRecord, turn: TurnRecord) {
    this.clearTurnTimer(turn)
    turn.cancelTimer = scheduleTimeout(() => {
      if (tab.activeTurn !== turn) return
      const error = new AcpTimeoutError('ACP prompt cancellation')
      const client = this.client
      const generation = turn.connectionGeneration
      if (
        client &&
        generation !== null &&
        generation !== 0 &&
        generation === this.activeGeneration
      ) {
        this.handleDisconnected(client, generation, {
          kind: 'connection-closed',
          error,
        })
        if (tab.closed) this.finishClosedTurn(tab, turn)
      } else if (tab.closed) {
        this.finishClosedTurn(tab, turn)
      } else {
        this.failTurn(tab, turn, error)
      }
    }, CANCEL_GRACE_MS)
  }

  private enqueueControlMutation(
    tab: TabRecord,
    operation: () => Promise<void>,
  ): Promise<void> {
    const running = tab.controlMutationTail
      .catch(() => undefined)
      .then(async () => {
        if (!this.canMutateTab(tab)) return
        await operation()
      })
    // Keep the queue usable after any unexpected implementation error while
    // returning the real operation promise to the caller.
    tab.controlMutationTail = running.catch(() => undefined)
    return running
  }

  private canMutateTab(tab: TabRecord): boolean {
    return !tab.closed && this.tabs.get(tab.tabId) === tab
  }

  private reportControlError(tab: TabRecord, error: unknown) {
    if (!this.canMutateTab(tab)) return
    const message = this.friendlyError(error)
    tab.controlError = message
    const state = tab.store.getState()
    tab.store.setStatus(state.status, message)
  }

  private clearControlError(tab: TabRecord) {
    const message = tab.controlError
    if (!message || !this.canMutateTab(tab)) return
    tab.controlError = null
    const state = tab.store.getState()
    if (state.error === message) tab.store.setStatus(state.status, null)
  }

  async setMode(tabId: string, modeId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.closed) return
    const revision = ++tab.modeMutationRevision
    tab.desiredMode = modeId
    return this.enqueueControlMutation(tab, async () => {
      if (!this.client?.isConnected) {
        if (!this.canMutateTab(tab)) return
        tab.store.setModeCurrent(modeId)
        if (revision === tab.modeMutationRevision) this.clearControlError(tab)
        return
      }
      try {
        const sessionId = await this.ensureSession(tab)
        if (!this.canMutateTab(tab)) return
        await this.request('session/set_mode', { sessionId, modeId })
        if (!this.canMutateTab(tab)) return
        tab.store.setModeCurrent(modeId)
        if (revision === tab.modeMutationRevision) this.clearControlError(tab)
      } catch (error) {
        if (!this.canMutateTab(tab) || revision !== tab.modeMutationRevision) {
          return
        }
        tab.desiredMode = tab.store.getState().mode?.current ?? null
        this.reportControlError(tab, error)
      }
    })
  }

  async setConfigOption(
    tabId: string,
    configId: string,
    value: string,
  ): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.closed) return
    const revision = (tab.configMutationRevisions.get(configId) ?? 0) + 1
    tab.configMutationRevisions.set(configId, revision)
    return this.enqueueControlMutation(tab, async () => {
      const isLatest = () =>
        tab.configMutationRevisions.get(configId) === revision

      try {
        // A fresh tab may display cached selectors before it owns a remote
        // session. Model-dependent options (for example thought_level) cannot
        // be updated safely by changing only currentValue: the agent must
        // recompute and return the full configOptions set for the new model.
        const sessionId = await this.ensureSession(tab)
        if (!this.canMutateTab(tab)) return
        const currentOption = tab.store
          .getState()
          .configOptions.find((option) => option.id === configId)
        if (
          !currentOption ||
          currentOption.type !== 'select' ||
          !flatSelectValues(currentOption).includes(value)
        ) {
          // A dependent option can disappear while this operation waits behind
          // a model change. Never send or persist a value from the stale menu.
          return
        }
        const response = await this.request<SetSessionConfigOptionResponse>(
          'session/set_config_option',
          { sessionId, configId, value },
        )
        if (!this.canMutateTab(tab)) return
        if (!Array.isArray(response.configOptions)) {
          throw new Error(
            'ACP session/set_config_option did not return configOptions',
          )
        }
        const confirmedOption = response.configOptions.find(
          (option) => option.id === configId,
        )
        if (
          !confirmedOption ||
          confirmedOption.type !== 'select' ||
          confirmedOption.currentValue !== value
        ) {
          throw new Error(`ACP did not apply config option: ${configId}`)
        }
        this.setLastConfigOptions(response.configOptions)
        tab.store.applyConfigOptions(response.configOptions)
        const modes = modesFromConfigOptions(response.configOptions)
        if (modes) tab.store.applyModes(modes.current, modes.available)
        this.persistConfigSelection(configId, value)
        if (isLatest()) this.clearControlError(tab)
      } catch (error) {
        if (this.canMutateTab(tab) && isLatest()) {
          this.reportControlError(tab, error)
        }
      }
    })
  }

  respondPermission(tabId: string, toolCallId: string, optionId: string) {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.closed) return false
    const sessionId = tab.sessionId
    if (!sessionId) return false
    return this.permissionManager.respond(sessionId, toolCallId, optionId)
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.connectionGeneration += 1
    this.activeGeneration = 0
    this.permissionManager.cancelAll()
    for (const tab of this.tabs.values()) {
      tab.closed = true
      if (tab.activeTurn) {
        this.clearTurnTimer(tab.activeTurn)
        tab.activeTurn.resolveSettled()
        tab.activeTurn = null
      }
    }
    this.tabs.clear()
    this.tabBySession.clear()
    this.openingBySession.clear()
    this.closingBySession.clear()
    this.remoteCloseBySession.clear()
    for (const turn of this.closingTurns) {
      this.clearTurnTimer(turn)
      turn.resolveSettled()
    }
    this.closingTurns.clear()
    const clients = new Set(
      [this.client, this.startingClient].filter(
        (client): client is AcpClientPort => client !== null,
      ),
    )
    this.client = null
    this.startingClient = null
    this.availability = 'unknown'
    this.startError = null
    this.availabilityListeners.clear()
    this.activityListeners.clear()
    for (const client of clients) void this.trackClientDisposal(client)
    this.disposePromise = this.clientTeardown
    return this.disposePromise
  }
}
