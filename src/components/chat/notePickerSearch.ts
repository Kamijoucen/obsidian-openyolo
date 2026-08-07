export const MAX_NOTE_PICKER_RESULTS = 200

export function filterAndSortNoteFiles<TFile extends { path: string }>(
  files: readonly TFile[],
  query: string,
  limit = MAX_NOTE_PICKER_RESULTS,
): { files: TFile[]; total: number } {
  const keyword = query.trim().toLowerCase()
  const matches = keyword
    ? files.filter((file) => file.path.toLowerCase().includes(keyword))
    : [...files]
  matches.sort((a, b) => a.path.localeCompare(b.path))
  return { files: matches.slice(0, limit), total: matches.length }
}
