export class PromptDraftController {
  private draft: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly delayMs: number,
    private readonly commit: (value: string) => Promise<void>,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  value(fallback: string): string {
    return this.draft ?? fallback
  }

  set(value: string): void {
    this.draft = value
    this.clearTimer()
    const schedule =
      typeof window === 'undefined'
        ? setTimeout
        : window.setTimeout.bind(window)
    this.timer = schedule(() => {
      this.timer = null
      void this.flush().catch(this.onError)
    }, this.delayMs)
  }

  async flush(): Promise<void> {
    this.clearTimer()
    const value = this.draft
    if (value === null) return
    await this.commit(value)
    if (this.draft === value) this.draft = null
  }

  discard(): void {
    this.clearTimer()
    this.draft = null
  }

  private clearTimer(): void {
    if (this.timer === null) return
    const cancel =
      typeof window === 'undefined'
        ? clearTimeout
        : window.clearTimeout.bind(window)
    cancel(this.timer)
    this.timer = null
  }
}
