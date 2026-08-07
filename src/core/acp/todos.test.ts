import {
  parseTodoEntries,
  parseTodoToolCall,
  shouldHideTodoToolCall,
} from './todos'

describe('todo entry parsing', () => {
  it('normalizes native ACP entries, statuses and priorities', () => {
    expect(
      parseTodoEntries([
        { content: 'Inspect vault', status: 'doing', priority: 'urgent' },
        { content: 'Write report', status: 'done', priority: 'low' },
        { content: 'Old task', status: 'canceled' },
        'Follow up',
      ]),
    ).toEqual([
      {
        content: 'Inspect vault',
        status: 'in_progress',
        priority: 'high',
      },
      { content: 'Write report', status: 'completed', priority: 'low' },
      { content: 'Old task', status: 'cancelled', priority: 'medium' },
      { content: 'Follow up', status: 'pending', priority: 'medium' },
    ])
  })

  it('distinguishes malformed values from a valid empty plan', () => {
    expect(parseTodoEntries('not an array')).toBeNull()
    expect(parseTodoEntries([{ result: true }])).toBeNull()
    expect(parseTodoEntries([])).toEqual([])
  })
})

describe('todo tool recognition and extraction', () => {
  const todoCall = {
    title: '4 todos',
    name: 'todowrite',
    rawInput: {
      todos: [{ content: 'Inspect vault', status: 'pending' }],
    },
  }

  it('reads the confirmed rawInput.todos location', () => {
    expect(parseTodoToolCall(todoCall)).toEqual({
      entries: [
        {
          content: 'Inspect vault',
          status: 'pending',
          priority: 'medium',
        },
      ],
    })
  })

  it('prefers canonical rawOutput.metadata.todos', () => {
    expect(
      parseTodoToolCall({
        ...todoCall,
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: '[{"content":"Content copy","status":"pending"}]',
            },
          },
        ],
        rawOutput: {
          output: '[{"content":"Ignored raw output"}]',
          metadata: {
            todos: [
              {
                content: 'Canonical result',
                status: 'completed',
                priority: 'high',
              },
            ],
          },
        },
      }),
    ).toEqual({
      entries: [
        {
          content: 'Canonical result',
          status: 'completed',
          priority: 'high',
        },
      ],
    })
  })

  it('uses JSON tool content ahead of a pending input snapshot', () => {
    expect(
      parseTodoToolCall({
        ...todoCall,
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: '```json\n{"todos":[{"content":"Completed copy","status":"completed"}]}\n```',
            },
          },
        ],
      }),
    ).toEqual({
      entries: [
        {
          content: 'Completed copy',
          status: 'completed',
          priority: 'medium',
        },
      ],
    })
  })

  it('extracts JSON from ACP embedded resource tool content', () => {
    expect(
      parseTodoToolCall({
        title: 'TodoWrite',
        content: [
          {
            type: 'content',
            content: {
              type: 'resource',
              resource: {
                uri: 'memory://todos.json',
                text: '[{"content":"From resource"}]',
              },
            },
          },
        ],
      }),
    ).toEqual({
      entries: [
        {
          content: 'From resource',
          status: 'pending',
          priority: 'medium',
        },
      ],
    })
  })

  it('ignores unverified generic raw input and output shapes', () => {
    for (const toolCall of [
      {
        title: 'Search results',
        rawOutput: {
          todos: [{ content: 'Root output todo', status: 'done' }],
        },
      },
      {
        title: 'Search results',
        rawOutput: {
          output: '[{"content":"Output text todo","status":"done"}]',
        },
      },
      {
        title: 'Search results',
        rawInput: { plan: [{ content: 'Generic plan' }] },
      },
      {
        title: 'Search results',
        content: [
          {
            type: 'content' as const,
            content: {
              type: 'text' as const,
              text: '[{"content":"Arbitrary JSON","status":"done"}]',
            },
          },
        ],
      },
    ]) {
      expect(parseTodoToolCall(toolCall)).toBeNull()
    }
  })

  it('does not accept generic item aliases inside a confirmed collection', () => {
    expect(
      parseTodoToolCall({
        rawInput: {
          todos: [{ title: 'Too generic' }, { description: 'Also generic' }],
        },
      }),
    ).toBeNull()
  })

  it('preserves a valid empty todo snapshot', () => {
    expect(parseTodoToolCall({ rawInput: { todos: [] } })).toEqual({
      entries: [],
    })
  })

  it('hides the duplicate tool body but keeps permission controls visible', () => {
    expect(
      shouldHideTodoToolCall({
        ...todoCall,
        status: 'in_progress',
        permission: null,
      }),
    ).toBe(true)
    expect(
      shouldHideTodoToolCall({
        ...todoCall,
        permission: { options: [{ optionId: 'allow', kind: 'allow_once' }] },
      }),
    ).toBe(false)
    expect(
      shouldHideTodoToolCall({
        ...todoCall,
        status: 'failed',
        permission: null,
      }),
    ).toBe(false)
  })
})
