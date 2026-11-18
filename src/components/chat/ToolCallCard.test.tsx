import { renderToStaticMarkup } from 'react-dom/server'

import type { ToolCallState } from '../../types/chat'

import ToolCallCard from './ToolCallCard'

jest.mock('../../contexts/language-context', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const completedOutput = [
  '<task id="ses_child" state="completed">',
  '<task_result>',
  'Final audit result',
  '</task_result>',
  '</task>',
].join('\n')

describe('ToolCallCard subagent result', () => {
  it('keeps the inline result collapsed by default without navigation UI', () => {
    const toolCall: ToolCallState = {
      toolCallId: 'task-1',
      title: 'Inspect notes',
      kind: 'other',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: { type: 'text', text: completedOutput },
        },
      ],
      locations: [],
      rawInput: {
        subagent_type: 'explore',
        description: 'Inspect notes',
        prompt: 'Inspect the vault notes',
      },
      rawOutput: { output: completedOutput },
      permission: null,
    }

    const markup = renderToStaticMarkup(
      <ToolCallCard toolCall={toolCall} onPermissionRespond={jest.fn()} />,
    )

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('Final audit result')
    expect(markup).not.toContain('Open subagent session')
    expect(markup).not.toContain('yolo-acp-open-subagent')
  })

  it('offers OpenCode 2 child navigation while retaining its actual running state', () => {
    const toolCall: ToolCallState = {
      toolCallId: 'delegate',
      name: 'subagent',
      title: 'Explore notes',
      kind: 'other',
      status: 'completed',
      content: [],
      locations: [],
      permission: null,
      rawInput: {
        agent: 'explore',
        description: 'Explore',
        prompt: 'Read notes',
      },
      rawOutput: { metadata: { sessionID: 'child', status: 'running' } },
    }
    const markup = renderToStaticMarkup(
      <ToolCallCard
        toolCall={toolCall}
        onPermissionRespond={jest.fn()}
        onOpenSubagent={jest.fn()}
      />,
    )
    expect(markup).toContain('Open subagent session')
    expect(markup).toContain('yolo-spinner')
    expect(markup).not.toContain('yolo-toolcall-status-success-ring')
  })

  it.each(['completed', 'unknown'] as const)(
    'shows %s child state in preference to stale delegation metadata',
    (status) => {
      const toolCall: ToolCallState = {
        toolCallId: 'delegate',
        name: 'subagent',
        title: 'Explore notes',
        kind: 'other',
        status: 'completed',
        content: [],
        locations: [],
        permission: null,
        rawInput: {
          agent: 'explore',
          description: 'Explore',
          prompt: 'Read notes',
        },
        rawOutput: { metadata: { sessionID: 'child', status: 'running' } },
      }
      const markup = renderToStaticMarkup(
        <ToolCallCard
          toolCall={toolCall}
          onPermissionRespond={jest.fn()}
          onOpenSubagent={jest.fn()}
          subagents={[
            {
              sessionId: 'child',
              parentSessionId: 'root',
              title: 'Explore',
              depth: 1,
              status,
              error: null,
            },
          ]}
        />,
      )
      expect(markup).toContain('Open subagent session')
      expect(markup).not.toContain('yolo-spinner')
      if (status === 'completed') {
        expect(markup).toContain('yolo-toolcall-status-success-ring')
        expect(markup).toContain('role="status">chat.subagentCompleted</span>')
      } else {
        expect(markup).not.toContain('yolo-subagent-status')
        expect(markup).not.toContain('yolo-toolcall-status-success-ring')
      }
    },
  )
})
