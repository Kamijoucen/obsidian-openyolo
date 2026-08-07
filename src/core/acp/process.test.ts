import { access } from 'node:fs/promises'

import { getShellEnv } from './env'
import { resolveOpencodeBinary } from './process'

jest.mock('node:fs/promises', () => ({
  access: jest.fn(),
  constants: { X_OK: 1 },
}))
jest.mock('./env', () => ({ getShellEnv: jest.fn() }))

const mockAccess = jest.mocked(access)
const mockGetShellEnv = jest.mocked(getShellEnv)

describe('resolveOpencodeBinary', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('rejects a configured relative path without validating or spawning it', async () => {
    await expect(resolveOpencodeBinary('./bin/opencode')).resolves.toBeNull()

    expect(mockAccess).not.toHaveBeenCalled()
    expect(mockGetShellEnv).not.toHaveBeenCalled()
  })

  it('validates an absolute configured path without waiting for shell env', async () => {
    mockAccess.mockResolvedValue(undefined)

    await expect(
      resolveOpencodeBinary('/opt/opencode/bin/opencode'),
    ).resolves.toBe('/opt/opencode/bin/opencode')

    expect(mockAccess).toHaveBeenCalledTimes(1)
    expect(mockGetShellEnv).not.toHaveBeenCalled()
  })
})
