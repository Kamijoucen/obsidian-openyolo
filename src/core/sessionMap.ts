import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import type { App } from 'obsidian'

import type { ChatSessionState } from '../types/chat'

import {
  findConversationLogBySessionId,
  mergeConversationDocuments,
  saveConversationLog,
  serializeConversation,
  vaultBasePath,
  writeConversationLog,
} from './chatLog'

/**
 * 会话 → 笔记的机器本地映射。key 是本机 opencode 会话 id，不同机器的
 * opencode 实例会话互不相同，因此该映射只与本机有关，必须存到 vault 之外
 * （~/.openyolo/）避免被 vault 同步带走。
 */
export type SessionMapEntry = {
  /** 笔记中的会话标记 id；恢复出的会话记录原笔记 id，保存时合并写回原文件 */
  id: string
  /** 笔记的库内相对路径 */
  path: string
}

type SessionMapFile = Record<string, Record<string, unknown>>

const SESSION_MAP_DIR = '.openyolo'
const SESSION_MAP_FILE = 'session-map.json'

const writeQueues = new Map<string, Promise<void>>()

function mapDirPath(home: string): string {
  return join(home, SESSION_MAP_DIR)
}

function mapFilePath(home: string): string {
  return join(mapDirPath(home), SESSION_MAP_FILE)
}

export async function ensureSessionMapDir(
  home: string = homedir(),
): Promise<void> {
  await fs.mkdir(mapDirPath(home), { recursive: true })
}

async function readSessionMap(home: string): Promise<SessionMapFile> {
  try {
    const raw = await fs.readFile(mapFilePath(home), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    return parsed as SessionMapFile
  } catch {
    return {}
  }
}

function normalizeEntry(raw: unknown): SessionMapEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, path } = raw as Record<string, unknown>
  if (typeof id !== 'string' || !id) return null
  if (typeof path !== 'string' || !path) return null
  return { id, path }
}

export async function lookupSessionMapping(
  vaultKey: string,
  sessionId: string,
  home: string = homedir(),
): Promise<SessionMapEntry | null> {
  const map = await readSessionMap(home)
  const vault = map[vaultKey]
  if (typeof vault !== 'object' || vault === null) return null
  return normalizeEntry(vault[sessionId])
}

async function mutateSessionMap(
  home: string,
  mutate: (map: SessionMapFile) => SessionMapFile,
): Promise<void> {
  await ensureSessionMapDir(home)
  const file = mapFilePath(home)
  const previous = writeQueues.get(file) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const next = mutate(await readSessionMap(home))
      const temp = `${file}.tmp`
      await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      await fs.rename(temp, file)
    })
  writeQueues.set(file, current)
  return current.finally(() => {
    if (writeQueues.get(file) === current) writeQueues.delete(file)
  })
}

export function recordSessionMapping(
  vaultKey: string,
  sessionId: string,
  entry: SessionMapEntry,
  home: string = homedir(),
): Promise<void> {
  return mutateSessionMap(home, (map) => ({
    ...map,
    [vaultKey]: { ...map[vaultKey], [sessionId]: entry },
  }))
}

export function removeSessionMapping(
  vaultKey: string,
  sessionId: string,
  home: string = homedir(),
): Promise<void> {
  return mutateSessionMap(home, (map) => {
    const vault = map[vaultKey]
    if (!vault || !(sessionId in vault)) return map
    const rest = Object.fromEntries(
      Object.entries(vault).filter(([key]) => key !== sessionId),
    )
    if (Object.keys(rest).length > 0) return { ...map, [vaultKey]: rest }
    return Object.fromEntries(
      Object.entries(map).filter(([key]) => key !== vaultKey),
    )
  })
}

/**
 * 查表保存：映射命中时按映射路径写入；恢复出的会话（映射 id 与本机会话 id
 * 不同）与原笔记正文合并后写回原文件，在同一文件中保留此前全部历史。
 * 路径失效时用映射 id 扫描自愈并更新映射；未命中走 chatLog 的老逻辑，
 * 成功后回写映射。返回写入的路径；没有可保存内容时返回 null。
 */
export async function saveConversationWithMap(
  app: App,
  folder: string,
  state: ChatSessionState,
  home: string = homedir(),
): Promise<string | null> {
  const sessionId = state.sessionId
  if (!sessionId) {
    return saveConversationLog(app, folder, state)
  }
  const vaultKey = vaultBasePath(app)
  const mapping = await lookupSessionMapping(vaultKey, sessionId, home)
  if (mapping) {
    const content = serializeConversation(state, mapping.id)
    if (!content) return null
    let target: string | null = null
    if (app.vault.getFileByPath(mapping.path)) {
      target = mapping.path
    } else {
      target = await findConversationLogBySessionId(app, folder, mapping.id)
    }
    if (!target) {
      await removeSessionMapping(vaultKey, sessionId, home)
    } else {
      let finalContent = content
      if (mapping.id !== sessionId) {
        const previous = await app.vault.adapter.read(target).catch(() => '')
        if (previous) {
          finalContent = mergeConversationDocuments(
            previous,
            content,
            sessionId,
          )
        }
      }
      await writeConversationLog(app, target, finalContent)
      if (target !== mapping.path) {
        await recordSessionMapping(
          vaultKey,
          sessionId,
          { id: mapping.id, path: target },
          home,
        )
      }
      return target
    }
  }
  const written = await saveConversationLog(app, folder, state)
  if (written) {
    await recordSessionMapping(
      vaultKey,
      sessionId,
      { id: sessionId, path: written },
      home,
    )
  }
  return written
}
