export function nodeReadableToWeb(
  nodeReadable: NodeJS.ReadableStream,
): ReadableStream<Uint8Array> {
  const destroyable = nodeReadable as NodeJS.ReadableStream & {
    destroy: () => void
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeReadable.on('data', (chunk: Buffer | string) => {
        const data =
          typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
        controller.enqueue(new Uint8Array(data))
      })
      nodeReadable.on('end', () => {
        controller.close()
      })
      nodeReadable.on('error', (error) => {
        controller.error(error)
      })
    },
    cancel() {
      destroyable.destroy()
    },
  })
}

export function nodeWritableToWeb(
  nodeWritable: NodeJS.WritableStream,
  onError?: (error: Error) => void,
): WritableStream<Uint8Array> {
  const destroyable = nodeWritable as NodeJS.WritableStream & {
    destroy: () => void
  }
  return new WritableStream<Uint8Array>({
    start(controller) {
      // Node emits pipe errors separately from the write callback. The ACP
      // connection also needs to close when the error arrives between writes.
      nodeWritable.on('error', (error: Error) => {
        controller.error(error)
        onError?.(error)
      })
    },
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        nodeWritable.write(Buffer.from(chunk), (error?: Error | null) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        nodeWritable.end((error?: Error | null) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
    abort() {
      destroyable.destroy()
    },
  })
}
