import {
  buildComposerAttachments,
  hasComposerContent,
  settleComposerDraft,
} from './composer'

describe('buildComposerAttachments', () => {
  it('deduplicates vault and external attachments by their semantic paths', () => {
    expect(
      buildComposerAttachments(
        { path: 'notes/context.md', name: 'context' },
        [
          { path: 'notes/context.md', name: 'duplicate' },
          { path: 'notes/selected.md', name: 'selected' },
        ],
        [
          { path: 'notes/context.md', name: 'external-same-path' },
          { path: '/tmp/reference.txt', name: 'reference.txt' },
          { path: '/tmp/reference.txt', name: 'duplicate.txt' },
        ],
      ),
    ).toEqual([
      { path: 'notes/context.md', name: 'context' },
      { path: 'notes/selected.md', name: 'selected' },
      {
        path: 'notes/context.md',
        name: 'external-same-path',
        absolute: true,
      },
      { path: '/tmp/reference.txt', name: 'reference.txt', absolute: true },
    ])
  })
})

describe('hasComposerContent', () => {
  it('rejects an empty draft', () => {
    expect(hasComposerContent('  ', [], [])).toBe(false)
  })

  it.each([
    ['text', 'hello', [], []],
    ['image', '', [{}], []],
    ['current note', '', [], [{ path: 'current.md', name: 'current' }]],
    ['selected note', '', [], [{ path: 'selected.md', name: 'selected' }]],
    [
      'external file',
      '',
      [],
      [{ path: '/tmp/context.txt', name: 'context.txt', absolute: true }],
    ],
  ])(
    'accepts a draft containing only %s',
    (_kind, text, images, attachments) => {
      expect(hasComposerContent(text, images, attachments)).toBe(true)
    },
  )
})

describe('settleComposerDraft', () => {
  const draft = {
    text: 'question',
    images: [{ data: 'image' }],
    notes: [{ path: 'selected.md' }],
    externalFiles: [{ path: '/tmp/context.txt' }],
  }

  it('clears only text and images when accepted', () => {
    const settled = settleComposerDraft(draft, 'accepted')

    expect(settled).toEqual({
      text: '',
      images: [],
      notes: draft.notes,
      externalFiles: draft.externalFiles,
    })
    expect(settled.notes).toBe(draft.notes)
    expect(settled.externalFiles).toBe(draft.externalFiles)
  })

  it.each(['busy', 'failed'] as const)(
    'retains the entire draft when submission is %s',
    (result) => {
      expect(settleComposerDraft(draft, result)).toBe(draft)
    },
  )
})
