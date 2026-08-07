import type { AttachedNote } from './NotePicker'

export type SubmitResult = 'accepted' | 'busy' | 'failed'

export type ComposerDraft<TImage, TNote, TExternalFile> = {
  text: string
  images: TImage[]
  notes: TNote[]
  externalFiles: TExternalFile[]
  excludedCurrentPath: string | null
}

export function isAutoAttachedCurrentNote(
  enabled: boolean,
  activePath: string | null,
  candidatePath: string,
): boolean {
  return enabled && activePath === candidatePath
}

export function buildComposerAttachments(
  currentNote: AttachedNote | null,
  selectedNotes: readonly AttachedNote[],
  externalFiles: readonly AttachedNote[],
): AttachedNote[] {
  const attachments: AttachedNote[] = []
  const seen = new Set<string>()

  const add = (attachment: AttachedNote, absolute: boolean) => {
    const key = `${absolute ? 'external' : 'vault'}:${attachment.path}`
    if (seen.has(key)) return
    seen.add(key)
    attachments.push({
      path: attachment.path,
      name: attachment.name,
      ...(absolute ? { absolute: true } : {}),
    })
  }

  if (currentNote) add(currentNote, false)
  for (const note of selectedNotes) add(note, false)
  for (const file of externalFiles) add(file, true)

  return attachments
}

export function hasComposerText(text: string): boolean {
  // Context enriches a prompt but is not a prompt by itself. Requiring
  // non-whitespace text keeps button clicks and Enter submission consistent.
  return text.trim().length > 0
}

export function settleComposerDraft<TImage, TNote, TExternalFile>(
  draft: ComposerDraft<TImage, TNote, TExternalFile>,
  result: SubmitResult,
): ComposerDraft<TImage, TNote, TExternalFile> {
  if (result !== 'accepted') return draft
  return { ...draft, text: '', images: [], excludedCurrentPath: null }
}
