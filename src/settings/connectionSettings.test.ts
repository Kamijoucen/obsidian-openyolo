import { sameConnectionSettings } from './connectionSettings'

describe('sameConnectionSettings', () => {
  const base = { opencodePath: '/bin/opencode', opencodeArgs: ['--one'] }

  it('compares argument values rather than array identity', () => {
    expect(
      sameConnectionSettings(base, {
        opencodePath: '/bin/opencode',
        opencodeArgs: ['--one'],
      }),
    ).toBe(true)
  })

  it('detects binary and argument changes', () => {
    expect(
      sameConnectionSettings(base, {
        opencodePath: '/other/opencode',
        opencodeArgs: ['--one'],
      }),
    ).toBe(false)
    expect(
      sameConnectionSettings(base, {
        opencodePath: '/bin/opencode',
        opencodeArgs: ['--two'],
      }),
    ).toBe(false)
  })
})
