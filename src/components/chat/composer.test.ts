import {
  buildComposerAttachments,
  hasComposerText,
  isAutoAttachedCurrentNote,
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

describe('hasComposerText', () => {
  it.each(['', '  \n '])('rejects empty text: %j', (text) => {
    expect(hasComposerText(text)).toBe(false)
  })

  it('accepts non-whitespace text', () => {
    expect(hasComposerText('hello')).toBe(true)
    expect(hasComposerText('  explain this  ')).toBe(true)
  })
})

describe('isAutoAttachedCurrentNote', () => {
  it('only reserves the active note while automatic attachment is enabled', () => {
    expect(isAutoAttachedCurrentNote(true, 'current.md', 'current.md')).toBe(
      true,
    )
    expect(isAutoAttachedCurrentNote(false, 'current.md', 'current.md')).toBe(
      false,
    )
    expect(isAutoAttachedCurrentNote(true, 'current.md', 'other.md')).toBe(
      false,
    )
  })
})

describe('settleComposerDraft', () => {
  const draft = {
    text: 'question',
    images: [{ data: 'image' }],
    notes: [{ path: 'selected.md' }],
    externalFiles: [{ path: '/tmp/context.txt' }],
    excludedCurrentPath: 'current.md',
  }

  it('clears only text and images when accepted', () => {
    const settled = settleComposerDraft(draft, 'accepted')

    expect(settled).toEqual({
      text: '',
      images: [],
      notes: draft.notes,
      externalFiles: draft.externalFiles,
      excludedCurrentPath: null,
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
