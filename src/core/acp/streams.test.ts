import { spawn } from 'node:child_process'
import { once } from 'node:events'

import { nodeWritableToWeb } from './streams'

it('rejects the Web Stream write when a child closes stdin mid-write', async () => {
  const child = spawn(
    process.execPath,
    ['-e', `process.stdin.once('data', () => process.exit(0))`],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  )
  const closed = once(child, 'close')
  const onError = jest.fn()
  const writer = nodeWritableToWeb(child.stdin, onError).getWriter()

  try {
    // Write more than a pipe can buffer, so the child exits before the write
    // callback completes. No test-side error listener may mask the regression.
    await expect(writer.write(new Uint8Array(4 * 1024 * 1024))).rejects.toEqual(
      expect.objectContaining({
        code: expect.stringMatching(/EPIPE|ECONNRESET/),
      }),
    )
    await expect(closed).resolves.toEqual([0, null])
    expect(onError).toHaveBeenCalledTimes(1)
  } finally {
    writer.releaseLock()
    child.kill()
    await closed
  }
})
