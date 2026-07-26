import {
  DEFAULT_SYSTEM_PROMPT_ZH,
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
  removeManagedBlock,
  upsertManagedBlock,
} from './agentsMd'

describe('upsertManagedBlock', () => {
  it('creates content for an empty file', () => {
    const result = upsertManagedBlock('', DEFAULT_SYSTEM_PROMPT_ZH)
    expect(result).toContain(MANAGED_BLOCK_START)
    expect(result).toContain(DEFAULT_SYSTEM_PROMPT_ZH.trim())
    expect(result).toContain(MANAGED_BLOCK_END)
  })

  it('appends the block after existing user content', () => {
    const result = upsertManagedBlock('# My rules\n', 'PROMPT')
    expect(result).toBe(
      `# My rules\n\n${MANAGED_BLOCK_START}\nPROMPT\n${MANAGED_BLOCK_END}\n`,
    )
  })

  it('replaces an existing managed block in place', () => {
    const first = upsertManagedBlock('# Rules\n', 'OLD')
    const second = upsertManagedBlock(first, 'NEW')
    expect(second).toContain('NEW')
    expect(second).not.toContain('OLD')
    expect(second).toContain('# Rules')
    expect(second.split(MANAGED_BLOCK_START)).toHaveLength(2)
  })

  it('preserves user content around the block', () => {
    const doc = `# Top\n\n${MANAGED_BLOCK_START}\nOLD\n${MANAGED_BLOCK_END}\n\n# Bottom\n`
    const result = upsertManagedBlock(doc, 'NEW')
    expect(result).toContain('# Top')
    expect(result).toContain('# Bottom')
    expect(result).toContain('NEW')
  })

  it('migrates legacy yolo-lite markers to the new markers', () => {
    const doc =
      '# Rules\n\n<!-- yolo-lite:start -->\nOLD\n<!-- yolo-lite:end -->\n'
    const result = upsertManagedBlock(doc, 'NEW')
    expect(result).toContain('NEW')
    expect(result).toContain(MANAGED_BLOCK_START)
    expect(result).not.toContain('yolo-lite')
    expect(result).toContain('# Rules')
  })
})

describe('removeManagedBlock', () => {
  it('removes the block and keeps other content', () => {
    const doc = `# Rules\n\n${MANAGED_BLOCK_START}\nPROMPT\n${MANAGED_BLOCK_END}\n\nmore\n`
    const result = removeManagedBlock(doc)
    expect(result).not.toContain('PROMPT')
    expect(result).toContain('# Rules')
    expect(result).toContain('more')
  })

  it('removes a legacy yolo-lite block', () => {
    const doc =
      '# Rules\n\n<!-- yolo-lite:start -->\nPROMPT\n<!-- yolo-lite:end -->\n\nmore\n'
    const result = removeManagedBlock(doc)
    expect(result).not.toContain('PROMPT')
    expect(result).toContain('more')
  })

  it('is a no-op when no block exists', () => {
    expect(removeManagedBlock('# Rules\n')).toBe('# Rules')
  })
})
