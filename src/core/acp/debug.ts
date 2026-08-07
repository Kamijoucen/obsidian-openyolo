const MAX_DEPTH = 4
const MAX_ARRAY_ITEMS = 20
const MAX_OBJECT_KEYS = 30
const MAX_VISIBLE_STRING = 200

const REDACTED_KEYS = new Set([
  'blob',
  'content',
  'data',
  'env',
  'headers',
  'path',
  'prompt',
  'rawinput',
  'rawoutput',
  'text',
  'uri',
])

const SECRET_KEY_PARTS = [
  'apikey',
  'authorization',
  'password',
  'secret',
  'token',
]

function isRedactedKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return (
    REDACTED_KEYS.has(normalized) ||
    SECRET_KEY_PARTS.some((part) => normalized.includes(part))
  )
}

function redactedSummary(value: unknown): string {
  if (typeof value === 'string') {
    return `[redacted string: ${value.length} chars]`
  }
  if (Array.isArray(value)) return `[redacted array: ${value.length} items]`
  return '[redacted]'
}

function sanitize(
  value: unknown,
  key: string | null,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (key && isRedactedKey(key)) {
    return redactedSummary(value)
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    return value
  }
  if (typeof value === 'string') {
    if (key === null) return redactedSummary(value)
    return value.length <= MAX_VISIBLE_STRING
      ? value
      : `${value.slice(0, MAX_VISIBLE_STRING)}… [${value.length} chars]`
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol') return `[symbol: ${value.description ?? ''}]`
  if (typeof value === 'function')
    return `[function: ${value.name || 'anonymous'}]`
  if (typeof value !== 'object') return '[unknown primitive]'
  if (depth >= MAX_DEPTH) return '[depth limit]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    const visible: unknown[] = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitize(item, null, depth + 1, seen))
    if (value.length > MAX_ARRAY_ITEMS) {
      visible.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`)
    }
    return visible
  }

  const entries = Object.entries(value)
  const result: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
    result[entryKey] = sanitize(entryValue, entryKey, depth + 1, seen)
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    result._truncatedKeys = entries.length - MAX_OBJECT_KEYS
  }
  return result
}

export function sanitizeDebugPayload(event: string, payload: unknown): unknown {
  if (event === 'stderr' && typeof payload === 'string') {
    return `[stderr summary: ${payload.length} chars]`
  }
  if (typeof payload === 'string') return redactedSummary(payload)
  return sanitize(payload, null, 0, new WeakSet())
}
