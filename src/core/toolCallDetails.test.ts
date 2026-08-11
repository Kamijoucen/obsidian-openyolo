import type { ToolCallContent } from '@agentclientprotocol/sdk'

import {
  getSubagentToolDetails,
  isSubagentRawOutputContent,
  parseOpenCodeTaskEnvelope,
} from './toolCallDetails'
const completedOutput = [
  '<task id="ses_child" state="completed">',
  '<task_result>',
  'Found three relevant notes.\n\n- First\n- Second',
  '</task_result>',
  '</task>',
].join('\n')

describe('OpenCode subagent tool details', () => {
  it('parses the concrete OpenCode task envelope', () => {
    expect(parseOpenCodeTaskEnvelope(completedOutput)).toEqual({
      sessionId: 'ses_child',
      state: 'completed',
      output: 'Found three relevant notes.\n\n- First\n- Second',
    })
  })

  it('prefers the runtime metadata session id and exposes clean output', () => {
    expect(
      getSubagentToolDetails({
        rawInput: {
          description: 'Inspect PARA structure',
          prompt: 'Inspect the vault',
          subagent_type: 'explore',
        },
        rawOutput: {
          output: completedOutput,
          metadata: {
            parentSessionId: 'ses_parent',
            sessionId: 'ses_child_from_metadata',
            model: { providerID: 'openai', modelID: 'gpt-5' },
          },
        },
      }),
    ).toEqual({
      state: 'completed',
      output: 'Found three relevant notes.\n\n- First\n- Second',
      rawOutputText: completedOutput,
    })
  })

  it('falls back to the task envelope when metadata is unavailable', () => {
    expect(
      getSubagentToolDetails({
        rawInput: {
          subagent_type: 'general',
          description: 'Inspect notes',
          prompt: 'Inspect the notes',
        },
        rawOutput: { output: completedOutput },
      }),
    ).toMatchObject({
      output: 'Found three relevant notes.\n\n- First\n- Second',
    })
  })

  it('does not use a resumed task_id as a live session fallback', () => {
    expect(
      getSubagentToolDetails({
        rawInput: {
          subagent_type: 'general',
          description: 'Continue inspecting notes',
          prompt: 'Resume the previous audit',
          task_id: 'ses_resumed',
        },
        rawOutput: { output: 'Result without task identity' },
      }),
    ).toBeNull()
  })

  it('requires every concrete OpenCode task input field', () => {
    const rawOutput = {
      output: completedOutput,
      metadata: {
        parentSessionId: 'ses_parent',
        sessionId: 'ses_child',
      },
    }

    expect(
      getSubagentToolDetails({
        rawInput: {
          description: 'Inspect notes',
          prompt: 'Inspect the vault notes',
        },
        rawOutput,
      }),
    ).toBeNull()
    expect(
      getSubagentToolDetails({
        rawInput: {
          subagent_type: 'explore',
          prompt: 'Inspect the vault notes',
        },
        rawOutput,
      }),
    ).toBeNull()
    expect(
      getSubagentToolDetails({
        rawInput: {
          subagent_type: 'explore',
          description: 'Inspect notes',
        },
        rawOutput,
      }),
    ).toBeNull()
  })

  it('does not create an inline result before output is available', () => {
    const waiting = getSubagentToolDetails({
      rawInput: {
        subagent_type: 'general',
        description: 'Inspect notes',
        prompt: 'Inspect the notes',
      },
    })

    expect(waiting).toBeNull()
  })

  it('does not treat arbitrary raw metadata as a subagent result', () => {
    expect(
      getSubagentToolDetails({
        rawInput: { query: 'notes' },
        rawOutput: {
          output: 'ordinary tool output',
          metadata: { sessionId: 'unrelated-session' },
        },
      }),
    ).toBeNull()
    expect(
      getSubagentToolDetails({
        rawInput: { query: 'notes' },
        rawOutput: {
          metadata: {
            parentSessionId: 'ses_parent',
            sessionId: 'ses_unrelated',
          },
        },
      }),
    ).toBeNull()

    const unrelatedTaskId = {
      rawInput: { query: 'notes', task_id: 'ses_fake' },
      rawOutput: {
        metadata: {
          parentSessionId: 'ses_parent',
          sessionId: 'ses_also_fake',
        },
      },
    }
    expect(getSubagentToolDetails(unrelatedTaskId)).toBeNull()

    expect(
      getSubagentToolDetails({
        rawInput: {
          subagent_type: 'explore',
          task_id: 'ses_incomplete_shape',
        },
      }),
    ).toBeNull()

    expect(
      getSubagentToolDetails({
        rawInput: { query: 'notes' },
        rawOutput: { output: completedOutput },
      }),
    ).toBeNull()
  })

  it('identifies the duplicated ACP content block', () => {
    const details = getSubagentToolDetails({
      rawInput: {
        subagent_type: 'explore',
        description: 'Inspect notes',
        prompt: 'Inspect the vault notes',
      },
      rawOutput: { output: completedOutput },
    })
    const content: ToolCallContent = {
      type: 'content',
      content: { type: 'text', text: completedOutput },
    }

    expect(details).not.toBeNull()
    expect(isSubagentRawOutputContent(content, details!)).toBe(true)
    expect(
      isSubagentRawOutputContent(
        { type: 'content', content: { type: 'text', text: 'other' } },
        details!,
      ),
    ).toBe(false)
    expect(
      isSubagentRawOutputContent(
        {
          type: 'content',
          content: { type: 'text', text: `${completedOutput}\n` },
        },
        details!,
      ),
    ).toBe(true)
  })

  it('parses task errors without exposing envelope markup', () => {
    const failed = [
      "<task id='ses_failed' state='error'>",
      '<task_error>',
      'Permission denied',
      '</task_error>',
      '</task>',
    ].join('\n')

    expect(parseOpenCodeTaskEnvelope(failed)).toEqual({
      sessionId: 'ses_failed',
      state: 'error',
      output: 'Permission denied',
    })
  })

  it('recognizes running task output without exposing envelope markup', () => {
    const runningOutput = [
      '<task id="ses_background" state="running">',
      '<task_result>',
      'The task is working in the background.',
      '</task_result>',
      '</task>',
    ].join('\n')
    const details = getSubagentToolDetails({
      rawInput: {
        subagent_type: 'explore',
        description: 'Inspect notes',
        prompt: 'Inspect the vault notes',
      },
      rawOutput: { output: runningOutput },
    })

    expect(details).toEqual({
      state: 'running',
      output: 'The task is working in the background.',
      rawOutputText: runningOutput,
    })
  })

  it('ignores metadata-only tasks because there is nothing to display', () => {
    const metadataOnly = getSubagentToolDetails({
      rawInput: {
        subagent_type: 'explore',
        description: 'Inspect notes',
        prompt: 'Inspect the vault notes',
      },
      rawOutput: {
        metadata: {
          parentSessionId: 'ses_parent',
          sessionId: 'ses_background_without_envelope',
          background: true,
        },
      },
    })
    expect(metadataOnly).toBeNull()
  })
})
