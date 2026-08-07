import { shellEnv } from 'shell-env'

import { getShellEnv } from './env'

jest.mock('shell-env', () => ({ shellEnv: jest.fn() }))

const mockShellEnv = jest.mocked(shellEnv)

it('does not cache a shell environment lookup before it settles', async () => {
  let resolveFirst!: (env: Readonly<Record<string, string>>) => void
  const first = new Promise<Readonly<Record<string, string>>>((resolve) => {
    resolveFirst = resolve
  })
  const secondEnv = { PATH: '/second/bin' }
  mockShellEnv.mockReturnValueOnce(first).mockResolvedValueOnce(secondEnv)

  const firstLookup = getShellEnv()
  const secondLookup = getShellEnv()

  await expect(secondLookup).resolves.toBe(secondEnv)
  expect(mockShellEnv).toHaveBeenCalledTimes(2)

  resolveFirst({ PATH: '/first/bin' })
  await firstLookup
})
