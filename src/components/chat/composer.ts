import type { AttachedNote } from './NotePicker'

export type SubmitResult = 'accepted' | 'busy' | 'failed'

export type ComposerDraft<TImage, TNote, TExternalFile> = {
  text: string
  images: TImage[]
  notes: TNote[]
  externalFiles: TExternalFile[]
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

export function hasComposerContent(
  text: string,
  images: readonly unknown[],
  attachments: readonly AttachedNote[],
): boolean {
  return text.trim().length > 0 || images.length > 0 || attachments.length > 0
}

export function settleComposerDraft<TImage, TNote, TExternalFile>(
  draft: ComposerDraft<TImage, TNote, TExternalFile>,
  result: SubmitResult,
): ComposerDraft<TImage, TNote, TExternalFile> {
  if (result !== 'accepted') return draft
  return { ...draft, text: '', images: [] }
}
