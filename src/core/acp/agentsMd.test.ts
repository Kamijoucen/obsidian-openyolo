import type { App } from 'obsidian'

import {
  AGENTS_MD_FILE,
  DEFAULT_SYSTEM_PROMPT_ZH,
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
  hasManagedBlock,
  removeManagedBlock,
  syncAgentsMd,
  upsertManagedBlock,
} from './agentsMd'

const LEGACY_BLOCK_START = '<!-- yolo-lite:start -->'
const LEGACY_BLOCK_END = '<!-- yolo-lite:end -->'

function count(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('upsertManagedBlock', () => {
  it('creates content for an empty file', () => {
    const result = upsertManagedBlock('', DEFAULT_SYSTEM_PROMPT_ZH)
    expect(result).toContain(MANAGED_BLOCK_START)
    expect(result).toContain(DEFAULT_SYSTEM_PROMPT_ZH.trim())
    expect(result).toContain(MANAGED_BLOCK_END)
  })

  it('appends the block without changing existing trailing bytes', () => {
    const existing = '# My rules  \n'
    const result = upsertManagedBlock(existing, 'PROMPT')
    expect(result).toBe(
      `${existing}\n${MANAGED_BLOCK_START}\nPROMPT\n${MANAGED_BLOCK_END}\n`,
    )
  })

  it('replaces an existing managed block in place', () => {
    const first = upsertManagedBlock('# Rules\n', 'OLD')
    const second = upsertManagedBlock(first, 'NEW')
    expect(second).toContain('NEW')
    expect(second).not.toContain('OLD')
    expect(second).toContain('# Rules')
    expect(count(second, MANAGED_BLOCK_START)).toBe(1)
  })

  it('preserves every byte around a CRLF managed block', () => {
    const prefix = '\uFEFF # Top  \r\n\t\r\n'
    const suffix = '\r\n \t\n# Bottom  \n\n'
    const existing = `${prefix}${MANAGED_BLOCK_START}\r\nOLD\r\n${MANAGED_BLOCK_END}${suffix}`

    expect(upsertManagedBlock(existing, 'NEW')).toBe(
      `${prefix}${MANAGED_BLOCK_START}\r\nNEW\r\n${MANAGED_BLOCK_END}${suffix}`,
    )
  })

  it('canonicalizes multiple current and legacy blocks while preserving gaps', () => {
    const prefix = '# User\n\n'
    const gap = '\nUSER GAP \t\n'
    const suffix = '\nTAIL\n'
    const existing =
      `${prefix}${MANAGED_BLOCK_START}\nFIRST\n${MANAGED_BLOCK_END}` +
      `${gap}${LEGACY_BLOCK_START}\nSECOND\n${LEGACY_BLOCK_END}${suffix}`

    expect(upsertManagedBlock(existing, 'NEW')).toBe(
      `${prefix}${MANAGED_BLOCK_START}\nNEW\n${MANAGED_BLOCK_END}${gap}${suffix}`,
    )
  })

  it('migrates a paired legacy block to the current markers', () => {
    const existing = `# Rules\n\n${LEGACY_BLOCK_START}\nOLD\n${LEGACY_BLOCK_END}\n`
    const result = upsertManagedBlock(existing, 'NEW')
    expect(result).toContain('NEW')
    expect(result).toContain(MANAGED_BLOCK_START)
    expect(result).not.toContain('yolo-lite')
    expect(result).toContain('# Rules')
  })

  it('does not consume unmatched or cross-family marker text', () => {
    const existing = `${MANAGED_BLOCK_START}\nUSER DATA\n${LEGACY_BLOCK_END}\n`
    expect(hasManagedBlock(existing)).toBe(false)
    expect(removeManagedBlock(existing)).toBe(existing)
    expect(upsertManagedBlock(existing, 'NEW').startsWith(existing)).toBe(true)
  })

  it('neutralizes marker injection inside managed content', () => {
    const prompt = [
      'before',
      MANAGED_BLOCK_END,
      LEGACY_BLOCK_START,
      'after',
    ].join('\n')
    const result = upsertManagedBlock('', prompt)

    expect(count(result, MANAGED_BLOCK_START)).toBe(1)
    expect(count(result, MANAGED_BLOCK_END)).toBe(1)
    expect(result).not.toContain(LEGACY_BLOCK_START)
    expect(result).toContain('&lt;!-- openyolo:end -->')
    expect(hasManagedBlock(result)).toBe(true)
  })
})

describe('removeManagedBlock', () => {
  it('removes all blocks and preserves every outside byte', () => {
    const prefix = '# Rules  \n\n'
    const gap = '\n\tUSER GAP\n'
    const suffix = '\nmore  \n'
    const existing =
      `${prefix}${MANAGED_BLOCK_START}\nPROMPT\n${MANAGED_BLOCK_END}` +
      `${gap}${LEGACY_BLOCK_START}\nOLD\n${LEGACY_BLOCK_END}${suffix}`

    expect(removeManagedBlock(existing)).toBe(`${prefix}${gap}${suffix}`)
  })

  it('is a byte-for-byte no-op when no complete block exists', () => {
    const existing = ' # Rules\r\n\t\r\n'
    expect(removeManagedBlock(existing)).toBe(existing)
  })
})

type FakeFile = { path: string }

function asApp(vault: object): App {
  return { vault } as unknown as App
}

describe('syncAgentsMd', () => {
  it('uses Vault.process so the transform receives the latest file bytes', async () => {
    const file: FakeFile = { path: AGENTS_MD_FILE }
    let contents = '# External rules\n'
    const process = jest.fn(
      async (_file: FakeFile, update: (current: string) => string) => {
        contents += 'changed-before-process\n'
        contents = update(contents)
        return contents
      },
    )
    const vault = {
      getFileByPath: jest.fn(() => file),
      getAbstractFileByPath: jest.fn(() => file),
      process,
      create: jest.fn(),
    }

    await syncAgentsMd(asApp(vault), 'PROMPT', true)

    expect(process).toHaveBeenCalledTimes(1)
    expect(contents).toContain('changed-before-process')
    expect(contents).toContain('PROMPT')
    expect(vault.create).not.toHaveBeenCalled()
  })

  it('serializes concurrent requests for the same vault', async () => {
    const file: FakeFile = { path: AGENTS_MD_FILE }
    let contents = '# Rules\n'
    let active = 0
    let maxActive = 0
    let calls = 0
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const process = jest.fn(
      async (_file: FakeFile, update: (current: string) => string) => {
        calls += 1
        active += 1
        maxActive = Math.max(maxActive, active)
        if (calls === 1) await firstGate
        contents = update(contents)
        active -= 1
        return contents
      },
    )
    const vault = {
      getFileByPath: jest.fn(() => file),
      getAbstractFileByPath: jest.fn(() => file),
      process,
      create: jest.fn(),
    }
    const app = asApp(vault)

    const first = syncAgentsMd(app, 'FIRST', true)
    await Promise.resolve()
    await Promise.resolve()
    const second = syncAgentsMd(app, 'SECOND', true)
    await Promise.resolve()

    expect(process).toHaveBeenCalledTimes(1)
    releaseFirst()
    await Promise.all([first, second])

    expect(process).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)
    expect(contents).toContain('SECOND')
    expect(contents).not.toContain('FIRST')
  })

  it('creates a missing file once and does not create it when disabled', async () => {
    const create = jest.fn(async (_path: string, _data: string) => ({
      path: AGENTS_MD_FILE,
    }))
    const vault = {
      getFileByPath: jest.fn(() => null),
      getAbstractFileByPath: jest.fn(() => null),
      process: jest.fn(),
      create,
    }
    const app = asApp(vault)

    await syncAgentsMd(app, 'PROMPT', false)
    expect(create).not.toHaveBeenCalled()

    await syncAgentsMd(app, 'PROMPT', true)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[1]).toContain(MANAGED_BLOCK_START)
  })
})
