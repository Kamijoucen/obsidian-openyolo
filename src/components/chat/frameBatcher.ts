type FrameScheduler = (callback: FrameRequestCallback) => number
type FrameCanceller = (handle: number) => void

/** Coalesces a burst of values into the latest value emitted once per frame. */
export class FrameBatcher<T> {
  private handle: number | null = null
  private latest: T | undefined
  private hasLatest = false

  constructor(
    private readonly schedule: FrameScheduler,
    private readonly cancel: FrameCanceller,
    private readonly emit: (value: T) => void,
  ) {}

  push(value: T): void {
    this.latest = value
    this.hasLatest = true
    if (this.handle !== null) return
    this.handle = this.schedule(() => {
      this.handle = null
      const next = this.latest
      const shouldEmit = this.hasLatest
      this.latest = undefined
      this.hasLatest = false
      if (shouldEmit) this.emit(next as T)
    })
  }

  dispose(): void {
    if (this.handle !== null) this.cancel(this.handle)
    this.handle = null
    this.latest = undefined
    this.hasLatest = false
  }
}
