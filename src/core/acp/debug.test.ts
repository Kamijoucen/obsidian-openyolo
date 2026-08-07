import { sanitizeDebugPayload } from './debug'

describe('sanitizeDebugPayload', () => {
  it('redacts prompts, paths, content and base64 while retaining ids', () => {
    const sanitized = sanitizeDebugPayload('session/update', {
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'private note' }],
      path: '/vault/secret.md',
      update: {
        content: { type: 'image', data: 'base64-secret' },
        messageId: 'message-1',
      },
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).toContain('session-1')
    expect(serialized).toContain('message-1')
    expect(serialized).not.toContain('private note')
    expect(serialized).not.toContain('/vault/secret.md')
    expect(serialized).not.toContain('base64-secret')
  })

  it('does not print raw stderr', () => {
    expect(sanitizeDebugPayload('stderr', 'token=secret')).toBe(
      '[stderr summary: 12 chars]',
    )
  })

  it('redacts root strings and common credential containers', () => {
    expect(sanitizeDebugPayload('event', 'root-level private value')).toBe(
      '[redacted string: 24 chars]',
    )

    const sanitized = sanitizeDebugPayload('event', {
      accessToken: 'access-token-value',
      client_secret: 'client-secret-value',
      PASSWORD: 'password-value',
      authorization: 'Bearer credential',
      apiKey: 'api-key-value',
      headers: { cookie: 'session-cookie' },
      env: { OPENAI_API_KEY: 'environment-secret' },
      arguments: ['--credential=unkeyed-secret'],
      sessionId: 'session-visible',
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).toContain('session-visible')
    for (const secret of [
      'access-token-value',
      'client-secret-value',
      'password-value',
      'Bearer credential',
      'api-key-value',
      'session-cookie',
      'environment-secret',
      'unkeyed-secret',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('bounds arrays and circular structures', () => {
    const circular: { items: number[]; self?: unknown } = {
      items: Array.from({ length: 25 }, (_, index) => index),
    }
    circular.self = circular

    expect(sanitizeDebugPayload('event', circular)).toMatchObject({
      items: expect.arrayContaining(['[5 more items]']),
      self: '[circular]',
    })
  })
})
