import type { Stream } from '@agentclientprotocol/sdk/unstable'
import { z } from 'zod'

export const CHILD_SESSION_CAPABILITY = 'opencode/child-session-updates'
export const CHILD_SESSION_METHOD = 'opencode/session/child_update'
export const CHILD_SESSION_META = 'opencode/child-session'
export const CHILD_ROOT_META = 'openyolo/root-session'

const identity = {
  rootSessionId: z.string().min(1),
  childSessionId: z.string().min(1),
  parentSessionId: z.string().min(1),
  depth: z.number().int().min(1).max(100),
  title: z.string().optional(),
}

const statusSchema = z.object({
  ...identity,
  type: z.literal('status'),
  status: z.enum(['created', 'running', 'completed', 'failed', 'interrupted']),
  error: z.object({ type: z.string(), message: z.string() }).optional(),
})

const eventSchema = z.discriminatedUnion('type', [
  statusSchema,
  z.object({
    ...identity,
    type: z.literal('update'),
    update: z.looseObject({ sessionUpdate: z.string() }),
  }),
])

export type ChildSessionStatusNotification = z.infer<typeof statusSchema>

/**
 * Normalize OpenCode's child updates before SDK dispatch, so their enclosed
 * ACP payloads pass through the SDK's normal session/update validation too.
 * Status events have no standard v1 equivalent and keep their own callback.
 */
export function withChildSessionUpdates(
  stream: Stream,
  onStatus: (event: ChildSessionStatusNotification) => void,
): Stream {
  return {
    writable: stream.writable,
    readable: stream.readable.pipeThrough(
      new TransformStream({
        transform(message, controller) {
          if (
            !('method' in message) ||
            message.method !== CHILD_SESSION_METHOD
          ) {
            controller.enqueue(message)
            return
          }
          const parsed = eventSchema.safeParse(message.params)
          if (!parsed.success) return
          const event = parsed.data
          if (
            event.rootSessionId === event.childSessionId ||
            event.parentSessionId === event.childSessionId
          )
            return
          if (event.type === 'status') {
            onStatus(event)
            return
          }
          const meta = event.update._meta
          controller.enqueue({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: event.childSessionId,
              update: {
                ...event.update,
                _meta: {
                  ...(typeof meta === 'object' && meta !== null ? meta : {}),
                  [CHILD_ROOT_META]: event.rootSessionId,
                  [CHILD_SESSION_META]: {
                    id: event.childSessionId,
                    parentID: event.parentSessionId,
                    depth: event.depth,
                    title: event.title,
                  },
                },
              },
            },
          })
        },
      }),
    ),
  }
}

const projectedIdentity = z.object({
  id: z.string().min(1),
  parentID: z.string().min(1),
  depth: z.number().int().min(1).max(100),
  title: z.string().optional(),
})

export function childIdentityFromMeta(meta: unknown) {
  if (typeof meta !== 'object' || meta === null) return null
  const parsed = projectedIdentity.safeParse(
    (meta as Record<string, unknown>)[CHILD_SESSION_META],
  )
  return parsed.success ? parsed.data : null
}
