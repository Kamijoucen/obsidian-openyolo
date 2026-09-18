export type HistoryDirection = 'previous' | 'next'

/** Editing the input resets this cursor; recalled entries are never edited. */
export class InputHistoryNavigation {
  private index: number | null = null

  reset(): void {
    this.index = null
  }

  navigate(
    entries: readonly string[],
    direction: HistoryDirection,
  ): string | null {
    if (entries.length === 0) return null
    const index = Math.min(this.index ?? entries.length, entries.length)
    if (direction === 'previous') {
      if (index === 0) return null
      this.index = index - 1
      return entries[this.index]
    }
    if (index === entries.length) return null
    if (index === entries.length - 1) {
      this.reset()
      return ''
    }
    this.index = index + 1
    return entries[this.index]
  }
}

export function historyDirectionForKey(event: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  selectionStart: number
  selectionEnd: number
  textLength: number
}): HistoryDirection | null {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    event.selectionStart !== event.selectionEnd
  )
    return null
  if (event.key === 'ArrowUp' && event.selectionStart === 0) return 'previous'
  if (event.key === 'ArrowDown' && event.selectionEnd === event.textLength)
    return 'next'
  return null
}
