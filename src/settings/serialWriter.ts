/**
 * Serializes full-snapshot persistence so an older async write can never
 * finish after and overwrite a newer snapshot.
 */
export class SerialWriter<T> {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly writeValue: (value: T) => Promise<void>) {}

  write(value: T): Promise<void> {
    const task = this.tail.then(() => this.writeValue(value))
    // A failed write is reported to its caller but must not poison later writes.
    this.tail = task.catch(() => undefined)
    return task
  }
}
