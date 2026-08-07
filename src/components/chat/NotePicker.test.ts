import {
  MAX_NOTE_PICKER_RESULTS,
  filterAndSortNoteFiles,
} from './notePickerSearch'

describe('filterAndSortNoteFiles', () => {
  it('sorts a copy without mutating the vault array', () => {
    const source = [{ path: 'z.md' }, { path: 'a.md' }, { path: 'm.md' }]

    expect(filterAndSortNoteFiles(source, '').files).toEqual([
      { path: 'a.md' },
      { path: 'm.md' },
      { path: 'z.md' },
    ])
    expect(source.map((file) => file.path)).toEqual(['z.md', 'a.md', 'm.md'])
  })

  it('caps rendered matches while reporting the full match count', () => {
    const source = Array.from(
      { length: MAX_NOTE_PICKER_RESULTS + 5 },
      (_, index) => ({ path: `note-${String(index).padStart(3, '0')}.md` }),
    )

    const result = filterAndSortNoteFiles(source, 'note-')

    expect(result.files).toHaveLength(MAX_NOTE_PICKER_RESULTS)
    expect(result.total).toBe(MAX_NOTE_PICKER_RESULTS + 5)
  })
})
