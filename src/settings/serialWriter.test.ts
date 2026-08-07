import { SerialWriter } from './serialWriter'

function deferred(): {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
} {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('SerialWriter', () => {
  it('does not start a newer snapshot until the previous write settles', async () => {
    const first = deferred()
    const writes: number[] = []
    const writer = new SerialWriter<number>(async (value) => {
      writes.push(value)
      if (value === 1) await first.promise
    })

    const firstWrite = writer.write(1)
    const secondWrite = writer.write(2)
    await Promise.resolve()

    expect(writes).toEqual([1])
    first.resolve()
    await Promise.all([firstWrite, secondWrite])
    expect(writes).toEqual([1, 2])
  })

  it('continues serializing after a failed write', async () => {
    const writes: number[] = []
    const writer = new SerialWriter<number>(async (value) => {
      writes.push(value)
      if (value === 1) throw new Error('disk full')
    })

    await expect(writer.write(1)).rejects.toThrow('disk full')
    await expect(writer.write(2)).resolves.toBeUndefined()

    expect(writes).toEqual([1, 2])
  })
})
