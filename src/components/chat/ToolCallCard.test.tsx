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
})
