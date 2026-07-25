import type { SessionUpdate } from '@agentclientprotocol/sdk'

import { SessionStateStore } from './mapper'

function collect(store: SessionStateStore) {
  const snapshots: number[] = []
  store.subscribe((state) => {
    snapshots.push(state.entries.length)
  })
  return snapshots
}

describe('SessionStateStore', () => {
  it('appends assistant chunks grouped by messageId', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'Hello' },
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: ' world' },
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm2',
      content: { type: 'text', text: 'second' },
    } as SessionUpdate)

    const entries = store.getState().entries
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      kind: 'assistant',
      text: 'Hello world',
      streaming: true,
    })
    expect(entries[1]).toMatchObject({ kind: 'assistant', text: 'second' })
  })

  it('separates thought chunks into reasoning', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'agent_thought_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'thinking' },
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'answer' },
    } as SessionUpdate)

    const [entry] = store.getState().entries
    expect(entry).toMatchObject({
      kind: 'assistant',
      text: 'answer',
      reasoning: 'thinking',
    })
  })

  it('groups user chunks by messageId for replay', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: { type: 'text', text: 'hi' },
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: { type: 'text', text: ' there' },
    } as SessionUpdate)

    const entries = store.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'user', text: 'hi there' })
  })

  it('skips synthetic/ignored chunks flagged via audience annotations', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: { type: 'text', text: 'hi' },
    } as SessionUpdate)
    // opencode 把附件展开为 user 消息里的 synthetic 文本（模型上下文），
    // 回放时带 audience=['assistant']；不应混入用户气泡。
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: {
        type: 'text',
        text: 'Called the Read tool with the following input: {}',
        annotations: { audience: ['assistant'] },
      },
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a1',
      content: {
        type: 'text',
        text: 'hidden',
        annotations: { audience: ['user'] },
      },
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a1',
      content: { type: 'text', text: 'shown' },
    } as SessionUpdate)

    const entries = store.getState().entries
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ kind: 'user', text: 'hi' })
    expect(entries[1]).toMatchObject({ kind: 'assistant', text: 'shown' })
  })

  it('creates and updates tool calls in place', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'read file',
      kind: 'read',
      status: 'pending',
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'in_progress',
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
    } as SessionUpdate)

    const entries = store.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      toolCall: {
        toolCallId: 't1',
        title: 'read file',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
      },
    })
  })

  it('creates a tool entry when an update arrives before tool_call', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't9',
      title: 'late',
      status: 'completed',
    } as SessionUpdate)
    const entries = store.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      toolCall: { toolCallId: 't9', title: 'late', status: 'completed' },
    })
  })

  it('handles plan, usage, mode and commands updates', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [{ content: 'step 1', status: 'in_progress', priority: 'high' }],
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'usage_update',
      used: 10,
      size: 100,
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'current_mode_update',
      currentModeId: 'plan',
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'init', description: 'init project' }],
    } as SessionUpdate)

    const state = store.getState()
    expect(state.plan).toHaveLength(1)
    expect(state.usage).toMatchObject({ used: 10, size: 100 })
    expect(state.mode?.current).toBe('plan')
    expect(state.commands).toHaveLength(1)
  })

  it('marks turn end and clears streaming flags', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'hi' },
    } as SessionUpdate)
    store.markRunning()
    expect(store.getState().status).toBe('running')
    store.markTurnEnd('end_turn')
    const state = store.getState()
    expect(state.status).toBe('idle')
    const [entry] = state.entries
    expect(entry).toMatchObject({ kind: 'assistant', streaming: false })
  })

  it('tracks the wait for the first visible response update', () => {
    const store = new SessionStateStore('test')
    store.appendLocalUserMessage('hello', [{ type: 'text', text: 'hello' }])
    store.markRunning()

    expect(store.getState().awaitingResponse).toBe(true)

    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: { type: 'text', text: 'hello' },
    } as SessionUpdate)
    expect(store.getState().awaitingResponse).toBe(true)

    store.applyUpdate({
      sessionUpdate: 'agent_thought_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'thinking' },
    } as SessionUpdate)
    expect(store.getState().awaitingResponse).toBe(false)
  })

  it('tracks pending permission on the tool call', () => {
    const store = new SessionStateStore('test')
    const options = [
      { optionId: 'once', kind: 'allow_once' as const, name: 'Allow once' },
      { optionId: 'reject', kind: 'reject_once' as const, name: 'Reject' },
    ]
    store.setPendingPermission(
      { toolCallId: 't1', title: 'edit', kind: 'edit', status: 'pending' },
      options,
    )
    let entry = store.getState().entries[0]
    expect(entry).toMatchObject({
      kind: 'tool',
      toolCall: { toolCallId: 't1', permission: { options } },
    })
    expect(store.hasPendingPermission('t1')).toBe(true)

    store.clearPendingPermission('t1')
    entry = store.getState().entries[0]
    expect(entry.kind === 'tool' && entry.toolCall.permission).toBeNull()
    expect(store.hasPendingPermission('t1')).toBe(false)
  })

  it('notifies subscribers on updates', () => {
    const store = new SessionStateStore('test')
    const snapshots = collect(store)
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'a' },
    } as SessionUpdate)
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [],
    } as SessionUpdate)
    expect(snapshots.length).toBe(2)
  })

  it('replaces entry objects on updates so memoized views re-render', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'a' },
    } as SessionUpdate)
    const before = store.getState().entries[0]
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'b' },
    } as SessionUpdate)
    const after = store.getState().entries[0]
    expect(after).not.toBe(before)
    expect(after).toMatchObject({ text: 'ab' })
  })

  it('replaces tool entry objects on tool_call_update', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'read',
      kind: 'read',
      status: 'pending',
    } as SessionUpdate)
    const before = store.getState().entries[0]
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'in_progress',
    } as SessionUpdate)
    const after = store.getState().entries[0]
    expect(after).not.toBe(before)
    expect(after.kind === 'tool' && after.toolCall.status).toBe('in_progress')
  })
})
