export const INPUT_HISTORY_LIMIT = 32

/** One input history per plugin instance, shared by every chat session. */
export class InputHistory {
  private entries: readonly string[] = []

  constructor(private readonly persist: () => Promise<void>) {}

  restore(value: unknown): void {
    this.entries = Array.isArray(value)
      ? value
          .filter(
            (entry): entry is string =>
              typeof entry === 'string' && entry.trim().length > 0,
          )
          .slice(-INPUT_HISTORY_LIMIT)
      : []
  }

  getEntries(): readonly string[] {
    return this.entries
  }

  async append(text: string): Promise<void> {
    if (!text.trim()) return
    this.entries = [...this.entries, text].slice(-INPUT_HISTORY_LIMIT)
    await this.persist()
  }
}
