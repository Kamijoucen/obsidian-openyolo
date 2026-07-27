import type {
  ClientContext,
  ContentBlock,
  Implementation,
  ListSessionsResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  SessionConfigOption,
  SessionMode,
  SessionNotification,
  SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk'
import type { App } from 'obsidian'

import type { YoloSettings } from '../../settings/schema/setting.types'
import type { ChatSessionState, HistorySessionInfo } from '../../types/chat'

import { AcpClient, OpencodeNotFoundError } from './client'
import { FsBridge } from './fsBridge'
import { SessionStateStore } from './mapper'
import { PermissionManager } from './permissions'

export type ChatTabInfo = {
  tabId: string
  isHistory: boolean
}

export type AvailabilityState = 'unknown' | 'starting' | 'ready' | 'unavailable'

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
  closed: boolean
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
  private client: AcpClient | null = null
  private startPromise: Promise<void> | null = null
  private availability: AvailabilityState = 'unknown'
  private startError: string | null = null
  private tabs = new Map<string, TabRecord>()
  private tabBySession = new Map<string, string>()
  private permissionManager: PermissionManager
  private availabilityListeners = new Set<(state: AvailabilityState) => void>()
  private tabsListeners = new Set<() => void>()
  private activityListeners = new Set<() => void>()
  private lastConfigOptions: SessionConfigOption[] = []

  constructor(
    private readonly app: App,
    private readonly getSettings: () => YoloSettings,
    private readonly clientVersion: string,
    private readonly persistConfigSelection: (
      configId: string,
      value: string,
    ) => void = () => undefined,
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
    this.availability = state
    this.startError = error
    for (const listener of this.availabilityListeners) listener(state)
  }

  async ensureStarted(): Promise<void> {
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
      this.startPromise = null
    }
  }

  private async start(): Promise<void> {
    this.setAvailability('starting')
    const settings = this.getSettings()
    const client = new AcpClient({
      configuredPath: settings.opencodePath,
      extraArgs: settings.opencodeArgs,
      cwd: this.vaultCwd(),
      clientName: 'openyolo',
      clientVersion: this.clientVersion,
    })
    const fsBridge = new FsBridge(this.app)
    try {
      await client.connect({
        fsBridge,
        permissionManager: this.permissionManager,
        onSessionUpdate: (notification) =>
          this.handleSessionUpdate(notification),
        onPermissionPending: (params) => {
          this.debug('session/request_permission', params)
          const tabId = this.tabBySession.get(params.sessionId)
          const tab = tabId ? this.tabs.get(tabId) : null
          tab?.store.setPendingPermission(params.toolCall, params.options)
        },
        onPermissionSettled: (toolCallId) => {
          this.debug('permission settled', { toolCallId })
          for (const tab of this.tabs.values()) {
            tab.store.clearPendingPermission(toolCallId)
          }
        },
        onStderr: (line) => {
          this.debug('stderr', line)
        },
        onDebug: (event, payload) => {
          this.debug(event, payload)
        },
        onProcessExit: (code, signal) => {
          this.handleProcessExit(code, signal)
        },
      })
    } catch (error) {
      this.client = null
      if (error instanceof OpencodeNotFoundError) {
        this.setAvailability('unavailable', 'opencode-not-found')
      } else {
        this.setAvailability('unavailable', errorMessage(error))
      }
      throw error
    }
    this.client = client
    this.setAvailability('ready')
  }

  private handleProcessExit(code: number | null, signal: string | null) {
    this.client = null
    const reason = `opencode exited (code=${code ?? 'null'} signal=${
      signal ?? 'null'
    })`
    for (const tab of this.tabs.values()) {
      if (tab.store.getState().status === 'running') {
        tab.store.markTurnEnd(null)
      }
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

  onTabsChange(listener: () => void): () => void {
    this.tabsListeners.add(listener)
    return () => {
      this.tabsListeners.delete(listener)
    }
  }

  private emitTabsChange() {
    for (const listener of this.tabsListeners) listener()
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
      if (tab.store.getState().status === 'running') count += 1
    }
    return count
  }

  listTabs(): ChatTabInfo[] {
    return [...this.tabs.values()].map((tab) => ({
      tabId: tab.tabId,
      isHistory: tab.sessionId !== null,
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
    if (this.lastConfigOptions.length > 0) {
      store.applyConfigOptions(this.lastConfigOptions)
      const modes = modesFromConfigOptions(this.lastConfigOptions)
      if (modes) {
        store.applyModes(modes.current, modes.available)
      }
    }
    const tab: TabRecord = {
      tabId,
      store,
      sessionId: null,
      desiredMode: this.getSettings().defaultMode,
      closed: false,
    }
    this.tabs.set(tabId, tab)
    this.emitTabsChange()
    // Eagerly create the ACP session so model/effort selectors populate from
    // opencode right away instead of after the first prompt.
    void this.ensureStarted()
      .then(() => this.ensureSession(tab))
      .catch(() => undefined)
    return tabId
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
    return this.createTab()
  }

  async openHistoryTab(sessionId: string, title: string): Promise<string> {
    await this.ensureStarted()
    const tabId = nextTabId()
    const store = new SessionStateStore(title)
    const tab: TabRecord = {
      tabId,
      store,
      sessionId,
      desiredMode: null,
      closed: false,
    }
    this.tabs.set(tabId, tab)
    this.tabBySession.set(sessionId, tabId)
    store.setSessionId(sessionId)
    store.setStatus('loading')
    this.emitTabsChange()
    try {
      const response = await this.request<LoadSessionResponse>('session/load', {
        sessionId,
        cwd: this.vaultCwd(),
        mcpServers: [],
      })
      const modes = modesFromConfigOptions(response.configOptions)
      if (modes) {
        store.applyModes(modes.current, modes.available)
      }
      if (response.configOptions) {
        this.setLastConfigOptions(response.configOptions)
        store.applyConfigOptions(response.configOptions)
        await this.applyConfigSelections(tab, sessionId, response.configOptions)
      }
      store.markTurnEnd(null)
    } catch (error) {
      store.setStatus('error', this.friendlyError(error))
    }
    this.emitActivity()
    return tabId
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    tab.closed = true
    const sessionId = tab.sessionId
    this.tabs.delete(tabId)
    if (sessionId) {
      this.tabBySession.delete(sessionId)
      this.permissionManager.cancelSession(sessionId)
      if (this.client?.isConnected) {
        void this.request('session/close', { sessionId }).catch(() => undefined)
      }
    }
    this.emitTabsChange()
    this.emitActivity()
  }

  async listHistory(): Promise<HistorySessionInfo[]> {
    await this.ensureStarted()
    const sessions: HistorySessionInfo[] = []
    let cursor: string | null | undefined = null
    do {
      const response: ListSessionsResponse =
        await this.request<ListSessionsResponse>('session/list', {
          cwd: this.vaultCwd(),
          cursor,
        })
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
      cursor = response.nextCursor ?? null
    } while (cursor)
    sessions.sort((a, b) =>
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
    )
    return sessions
  }

  private async ensureSession(tab: TabRecord): Promise<string> {
    if (tab.sessionId) return tab.sessionId
    if (tab.closed) throw new Error('Tab is closed')
    const response = await this.request<NewSessionResponse>('session/new', {
      cwd: this.vaultCwd(),
      mcpServers: [],
    })
    tab.sessionId = response.sessionId
    this.tabBySession.set(response.sessionId, tab.tabId)
    tab.store.setSessionId(response.sessionId)
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
      this.setLastConfigOptions(response.configOptions)
      tab.store.applyConfigOptions(response.configOptions)
    }
    await this.applyConfigSelections(
      tab,
      response.sessionId,
      response.configOptions ?? [],
    )
    const desired = tab.desiredMode
    if (desired) {
      const available = modes?.available ?? []
      if (
        available.some((mode) => mode.id === desired) &&
        modes?.current !== desired
      ) {
        await this.request('session/set_mode', {
          sessionId: response.sessionId,
          modeId: desired,
        }).catch(() => undefined)
        tab.store.setModeCurrent(desired)
      }
    }
    this.emitTabsChange()
    return response.sessionId
  }

  private agent(): ClientContext {
    if (!this.client) throw new Error('ACP client is not connected')
    return this.client.agent()
  }

  private debug(event: string, payload?: unknown) {
    if (!this.getSettings().debugLog) return
    console.debug('[openyolo]', event, payload ?? '')
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    this.debug(`→ ${method}`, params)
    try {
      const response = await this.agent().request<T>(method, params)
      this.debug(`← ${method}`, response)
      return response
    } catch (error) {
      this.debug(`✕ ${method}`, errorMessage(error))
      throw error
    }
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    this.debug(`→ ${method}`, params)
    await this.agent().notify(method, params)
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
  ) {
    let currentOptions = options
    const apply = async (selection: { configId: string; value: string }) => {
      const res = await this.request<SetSessionConfigOptionResponse>(
        'session/set_config_option',
        {
          sessionId,
          configId: selection.configId,
          value: selection.value,
        },
      ).catch(() => null)
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
  ): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.closed) return
    await this.ensureStarted()
    tab.store.appendLocalUserMessage(text, blocks)
    tab.store.markRunning()
    this.emitActivity()
    try {
      const sessionId = await this.ensureSession(tab)
      const response = await this.request<PromptResponse>('session/prompt', {
        sessionId,
        prompt: blocks,
      })
      tab.store.markTurnEnd(response.stopReason ?? null)
    } catch (error) {
      tab.store.markTurnEnd(null)
      tab.store.setStatus('error', this.friendlyError(error))
    }
    this.emitActivity()
  }

  async cancel(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab || !tab.sessionId || !this.client?.isConnected) return
    this.permissionManager.cancelSession(tab.sessionId)
    await this.notify('session/cancel', { sessionId: tab.sessionId }).catch(
      () => undefined,
    )
  }

  async setMode(tabId: string, modeId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    tab.desiredMode = modeId
    tab.store.setModeCurrent(modeId)
    if (tab.sessionId && this.client?.isConnected) {
      await this.request('session/set_mode', {
        sessionId: tab.sessionId,
        modeId,
      }).catch(() => undefined)
    }
  }

  async setConfigOption(
    tabId: string,
    configId: string,
    value: string,
  ): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.persistConfigSelection(configId, value)
    if (!tab.sessionId || !this.client?.isConnected) {
      const optimistic = tab.store
        .getState()
        .configOptions.map((option) =>
          option.id === configId && option.type === 'select'
            ? { ...option, currentValue: value }
            : option,
        )
      tab.store.applyConfigOptions(optimistic)
      return
    }
    try {
      const response = await this.request<SetSessionConfigOptionResponse>(
        'session/set_config_option',
        {
          sessionId: tab.sessionId,
          configId,
          value,
        },
      )
      if (response.configOptions) {
        this.setLastConfigOptions(response.configOptions)
        tab.store.applyConfigOptions(response.configOptions)
      }
    } catch {
      // keep previous config options on failure
    }
  }

  respondPermission(tabId: string, toolCallId: string, optionId: string) {
    this.permissionManager.respond(toolCallId, optionId)
  }

  async dispose(): Promise<void> {
    this.permissionManager.cancelAll()
    for (const tab of this.tabs.values()) {
      tab.closed = true
    }
    this.tabs.clear()
    this.tabBySession.clear()
    await this.client?.dispose()
    this.client = null
    this.setAvailability('unknown')
  }
}
