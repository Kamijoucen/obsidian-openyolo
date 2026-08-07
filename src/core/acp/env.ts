import { shellEnv } from 'shell-env'

let cached: NodeJS.ProcessEnv | null = null

/**
 * Resolves the user's login-shell environment asynchronously and caches only
 * a completed result. A shell lookup that hangs must not poison every later
 * ACP startup attempt with the same permanently-pending promise.
 * shellEnvSync() would block the renderer main thread (it spawns the user's
 * shell synchronously) which is especially costly on the app-startup path.
 */
export async function getShellEnv(): Promise<NodeJS.ProcessEnv> {
  if (cached) return cached
  const resolved = await shellEnv().catch(() => ({ ...process.env }))
  cached ??= resolved
  return resolved
}
