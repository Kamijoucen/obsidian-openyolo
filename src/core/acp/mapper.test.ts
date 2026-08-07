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
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: ' world' },
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm2',
      content: { type: 'text', text: 'second' },
    })

    const entries = store.getState().entries
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      kind: 'assistant',
      text: 'Hello world',
      blocks: [],
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
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'answer' },
    })

    const [entry] = store.getState().entries
    expect(entry).toMatchObject({
      kind: 'assistant',
      text: 'answer',
      reasoning: 'thinking',
    })
  })

  it('preserves non-text assistant content blocks for rendering', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'visible text' },
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: {
        type: 'image',
        mimeType: 'image/png',
        data: 'aGVsbG8=',
      },
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: {
        type: 'resource_link',
        uri: 'file:///vault/result.md',
        name: 'result.md',
      },
    })

    expect(store.getState().entries[0]).toMatchObject({
      kind: 'assistant',
      text: 'visible text',
      blocks: [
        { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
        {
          type: 'resource_link',
          uri: 'file:///vault/result.md',
          name: 'result.md',
        },
      ],
    })
  })

  it('groups user chunks by messageId for replay', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: { type: 'text', text: 'hi' },
    })
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: { type: 'text', text: ' there' },
    })

    const entries = store.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'user',
      text: 'hi there',
      blocks: [],
    })
  })

  it('stores only non-text user blocks alongside the visible text', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: { type: 'text', text: 'inspect this' },
    })
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: {
        type: 'resource_link',
        uri: 'file:///vault/context.md',
        name: 'context.md',
      },
    })

    expect(store.getState().entries[0]).toMatchObject({
      kind: 'user',
      text: 'inspect this',
      blocks: [
        {
          type: 'resource_link',
          uri: 'file:///vault/context.md',
          name: 'context.md',
        },
      ],
    })
  })

  it('groups ACP v1 chunks without messageId across multiple replayed turns', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'first' },
    })
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: ' question' },
    })
    store.applyUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'first thought' },
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'first answer' },
    })
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: 'second question' },
    })
    store.applyUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'second thought' },
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'second answer' },
    })

    expect(store.getState().entries).toMatchObject([
      { kind: 'user', messageId: null, text: 'first question' },
      {
        kind: 'assistant',
        reasoning: 'first thought',
        text: 'first answer',
      },
      { kind: 'user', messageId: null, text: 'second question' },
      {
        kind: 'assistant',
        reasoning: 'second thought',
        text: 'second answer',
      },
    ])
  })

  it('starts a new v1 assistant entry after a live turn ends', () => {
    const store = new SessionStateStore('test')
    store.markRunning()
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'first' },
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: ' answer' },
    })
    store.markTurnEnd('end_turn')
    store.appendLocalUserMessage('again', [{ type: 'text', text: 'again' }])
    store.markRunning()
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'second answer' },
    })

    const assistants = store
      .getState()
      .entries.filter((entry) => entry.kind === 'assistant')
    expect(assistants).toMatchObject([
      { text: 'first answer', streaming: false },
      { text: 'second answer', streaming: true },
    ])
  })

  it('uses a new tool call as a boundary for v1 assistant text', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'before tool' },
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-boundary',
      title: 'Read note',
      kind: 'read',
      status: 'in_progress',
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'after tool' },
    })
    // A later update to the same tool is not a new transcript boundary.
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-boundary',
      status: 'completed',
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: ' continued' },
    })

    expect(store.getState().entries).toMatchObject([
      { kind: 'assistant', text: 'before tool' },
      { kind: 'tool', toolCall: { toolCallId: 'tool-boundary' } },
      { kind: 'assistant', text: 'after tool continued' },
    ])
  })

  it('skips synthetic/ignored chunks flagged via audience annotations', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'user_message_chunk',
      messageId: 'u1',
      content: { type: 'text', text: 'hi' },
    })
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
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a1',
      content: {
        type: 'text',
        text: 'hidden',
        annotations: { audience: ['user'] },
      },
    })
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a1',
      content: { type: 'text', text: 'shown' },
    })

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
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'in_progress',
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
    })

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
    })
    const entries = store.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'tool',
      toolCall: { toolCallId: 't9', title: 'late', status: 'completed' },
    })
  })

  it('maps TodoWrite payloads into the plan and keeps status updates current', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'todo-1',
      title: '2 todos',
      name: 'todowrite',
      kind: 'other',
      status: 'in_progress',
      rawInput: {
        todos: [
          { content: 'Inspect vault', status: 'in_progress', priority: 'high' },
          { content: 'Write report', status: 'pending', priority: 'medium' },
        ],
      },
    })

    expect(store.getState().plan).toEqual([
      {
        content: 'Inspect vault',
        status: 'in_progress',
        priority: 'high',
      },
      { content: 'Write report', status: 'pending', priority: 'medium' },
    ])
    // The protocol entry stays in state for permission handling and replay;
    // Timeline owns suppression of its duplicate JSON body.
    expect(store.getState().entries).toHaveLength(1)

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-1',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: {
            type: 'text',
            text: JSON.stringify([
              {
                content: 'Inspect vault',
                status: 'completed',
                priority: 'high',
              },
              {
                content: 'Write report',
                status: 'in_progress',
                priority: 'medium',
              },
            ]),
          },
        },
      ],
    })

    expect(store.getState().plan.map((entry) => entry.status)).toEqual([
      'completed',
      'in_progress',
    ])
  })

  it('rolls back an unconfirmed TodoWrite plan when the tool fails', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        {
          content: 'Previously confirmed',
          status: 'in_progress',
          priority: 'high',
        },
      ],
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'todo-failed',
      title: '1 todo',
      name: 'todowrite',
      kind: 'other',
      status: 'in_progress',
      rawInput: {
        todos: [{ content: 'Unconfirmed replacement', status: 'pending' }],
      },
    })

    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Unconfirmed replacement',
    ])

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-failed',
      status: 'failed',
    })

    expect(store.getState().plan).toEqual([
      {
        content: 'Previously confirmed',
        status: 'in_progress',
        priority: 'high',
      },
    ])
  })

  it('ignores a failed TodoWrite payload that was never applied', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Keep this plan', status: 'pending', priority: 'medium' },
      ],
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'todo-already-failed',
      title: '1 todo',
      name: 'todowrite',
      kind: 'other',
      status: 'failed',
      rawInput: { todos: [{ content: 'Never accepted' }] },
    })

    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Keep this plan',
    ])
  })

  it('does not let a stale TodoWrite failure overwrite a newer plan update', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'todo-stale',
      title: '1 todo',
      name: 'todowrite',
      status: 'in_progress',
      rawInput: { todos: [{ content: 'Optimistic plan' }] },
    })
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        {
          content: 'Authoritative plan',
          status: 'in_progress',
          priority: 'high',
        },
      ],
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-stale',
      status: 'failed',
    })

    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Authoritative plan',
    ])
  })

  it('restores the confirmed plan after overlapping TodoWrites fail', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Confirmed plan', status: 'pending', priority: 'medium' },
      ],
    })
    for (const [toolCallId, content] of [
      ['todo-a', 'Optimistic A'],
      ['todo-b', 'Optimistic B'],
    ] as const) {
      store.applyUpdate({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: '1 todo',
        name: 'todowrite',
        status: 'in_progress',
        rawInput: { todos: [{ content }] },
      })
    }

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-b',
      status: 'failed',
    })
    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Optimistic A',
    ])

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-a',
      status: 'failed',
    })
    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed plan',
    ])
  })

  it('keeps a completed TodoWrite when a newer optimistic call fails', () => {
    const store = new SessionStateStore('test')
    for (const [toolCallId, content] of [
      ['todo-a', 'Optimistic A'],
      ['todo-b', 'Optimistic B'],
    ] as const) {
      store.applyUpdate({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: '1 todo',
        name: 'todowrite',
        status: 'in_progress',
        rawInput: { todos: [{ content }] },
      })
    }
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-a',
      status: 'completed',
      rawOutput: {
        metadata: {
          todos: [{ content: 'Confirmed A', status: 'completed' }],
        },
      },
    })
    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Optimistic B',
    ])

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-b',
      status: 'failed',
    })
    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed A',
    ])
  })

  it('retires older candidates when the newer TodoWrite completes', () => {
    const store = new SessionStateStore('test')
    for (const [toolCallId, content] of [
      ['todo-a', 'Optimistic A'],
      ['todo-b', 'Optimistic B'],
    ] as const) {
      store.applyUpdate({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: '1 todo',
        name: 'todowrite',
        status: 'in_progress',
        rawInput: { todos: [{ content }] },
      })
    }

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-b',
      status: 'completed',
      rawOutput: {
        metadata: {
          todos: [{ content: 'Confirmed B', status: 'completed' }],
        },
      },
    })

    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed B',
    ])

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-a',
      status: 'completed',
      rawOutput: {
        metadata: {
          todos: [{ content: 'Late A', status: 'completed' }],
        },
      },
    })
    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed B',
    ])
  })

  it('does not apply TodoWrite input while permission is pending', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Confirmed plan', status: 'pending', priority: 'medium' },
      ],
    })

    store.setPendingPermission(
      {
        toolCallId: 'todo-permission-plan',
        title: '1 todo',
        name: 'todowrite',
        rawInput: { todos: [{ content: 'Needs approval' }] },
      },
      [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
    )

    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed plan',
    ])
  })

  it('withdraws an optimistic TodoWrite when permission becomes pending', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Confirmed plan', status: 'pending', priority: 'medium' },
      ],
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'todo-needs-permission',
      title: '1 todo',
      name: 'todowrite',
      status: 'pending',
      rawInput: { todos: [{ content: 'Optimistic plan' }] },
    })
    const snapshots = collect(store)

    store.setPendingPermission(
      {
        toolCallId: 'todo-needs-permission',
      },
      [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
    )

    expect(snapshots).toHaveLength(1)
    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed plan',
    ])
    expect(store.hasPendingPermission('todo-needs-permission')).toBe(true)

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-needs-permission',
      status: 'in_progress',
      rawInput: { todos: [{ content: 'Still awaiting approval' }] },
    })
    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed plan',
    ])
  })

  it('restores the confirmed plan when a turn ends without a terminal tool update', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Confirmed plan', status: 'pending', priority: 'medium' },
      ],
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'todo-interrupted',
      title: '1 todo',
      name: 'todowrite',
      status: 'in_progress',
      rawInput: { todos: [{ content: 'Interrupted plan' }] },
    })

    store.markTurnEnd('cancelled')

    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed plan',
    ])

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-interrupted',
      status: 'completed',
      rawOutput: {
        metadata: {
          todos: [{ content: 'Late completion', status: 'completed' }],
        },
      },
    })
    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed plan',
    ])
  })

  it('retires a partial permission call before a late completion reveals it is TodoWrite', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Confirmed plan', status: 'pending', priority: 'medium' },
      ],
    })
    store.setPendingPermission({ toolCallId: 'todo-partial-permission' }, [
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ])
    store.clearPendingPermission('todo-partial-permission')
    store.markTurnEnd('cancelled')

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-partial-permission',
      title: '1 todo',
      name: 'todowrite',
      status: 'completed',
      rawOutput: {
        metadata: {
          todos: [{ content: 'Late completion', status: 'completed' }],
        },
      },
    })

    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed plan',
    ])
  })

  it('retires a partial tool update before a late completion reveals it is TodoWrite', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Confirmed plan', status: 'pending', priority: 'medium' },
      ],
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-partial-update',
      status: 'pending',
    })
    store.markTurnEnd('cancelled')

    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-partial-update',
      title: '1 todo',
      name: 'todowrite',
      status: 'completed',
      rawOutput: {
        metadata: {
          todos: [{ content: 'Late completion', status: 'completed' }],
        },
      },
    })

    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Confirmed plan',
    ])
  })

  it('forgets optimistic TodoWrite state when replay is reset', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'todo-before-reset',
      title: '1 todo',
      name: 'todowrite',
      status: 'in_progress',
      rawInput: { todos: [{ content: 'Before reset' }] },
    })

    store.resetForReplay('session-1')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Replayed plan', status: 'pending', priority: 'medium' },
      ],
    })
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'todo-before-reset',
      status: 'failed',
    })

    expect(store.getState().plan.map((entry) => entry.content)).toEqual([
      'Replayed plan',
    ])
  })

  it('preserves TodoWrite permission state until the request settles', () => {
    const store = new SessionStateStore('test')
    store.setPendingPermission(
      {
        toolCallId: 'todo-permission',
        title: '1 todo',
        name: 'todo_write',
        rawInput: { todos: [{ content: 'Needs approval' }] },
      },
      [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    )

    const [entry] = store.getState().entries
    expect(entry).toMatchObject({
      kind: 'tool',
      toolCall: { permission: { options: [{ optionId: 'allow' }] } },
    })

    store.clearPendingPermission('todo-permission')
    expect(store.getState().entries[0]).toMatchObject({
      kind: 'tool',
      toolCall: { permission: null },
    })
  })

  it('handles plan, usage, mode and commands updates', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [{ content: 'step 1', status: 'in_progress', priority: 'high' }],
    })
    store.applyUpdate({
      sessionUpdate: 'usage_update',
      used: 10,
      size: 100,
    })
    store.applyUpdate({
      sessionUpdate: 'current_mode_update',
      currentModeId: 'plan',
    })
    store.applyUpdate({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'init', description: 'init project' }],
    })

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
    })
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
    })
    expect(store.getState().awaitingResponse).toBe(true)

    store.applyUpdate({
      sessionUpdate: 'agent_thought_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'thinking' },
    })
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
    })
    store.applyUpdate({
      sessionUpdate: 'plan',
      entries: [],
    })
    expect(snapshots.length).toBe(2)
  })

  it('replaces entry objects on updates so memoized views re-render', () => {
    const store = new SessionStateStore('test')
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'a' },
    })
    const before = store.getState().entries[0]
    store.applyUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: 'b' },
    })
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
    })
    const before = store.getState().entries[0]
    store.applyUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'in_progress',
    })
    const after = store.getState().entries[0]
    expect(after).not.toBe(before)
    expect(after.kind === 'tool' && after.toolCall.status).toBe('in_progress')
  })
})
