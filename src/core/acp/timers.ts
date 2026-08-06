export type TimerHandle = number

export function scheduleTimeout(
  callback: () => void,
  delayMs: number,
): TimerHandle {
  return window.setTimeout(callback, delayMs)
}

export function cancelTimeout(timer: TimerHandle): void {
  window.clearTimeout(timer)
}
