import { INPUT_HISTORY_LIMIT, InputHistory } from './inputHistory'

describe('InputHistory', () => {
  it('evicts the oldest entry before saving the 33rd input', async () => {
    const snapshots: Array<readonly string[]> = []
    const history = new InputHistory(async () => {
      snapshots.push(history.getEntries())
    })
    for (let index = 1; index <= 33; index++) {
      await history.append(`question ${index}`)
    }

    expect(history.getEntries()).toHaveLength(INPUT_HISTORY_LIMIT)
    expect(history.getEntries()[0]).toBe('question 2')
    expect(history.getEntries()[31]).toBe('question 33')
    expect(snapshots[31][0]).toBe('question 1')
    expect(snapshots[32]).toEqual(history.getEntries())
    expect(snapshots.every((snapshot) => snapshot.length <= 32)).toBe(true)
  })

  it('restores persisted history and bounds malformed or oversized data', () => {
    const persist = jest.fn(async () => undefined)
    const history = new InputHistory(persist)
    const entries = Array.from(
      { length: 35 },
      (_, index) => `question ${index}`,
    )
    history.restore([null, false, {}, '', ...entries, ' \n '])

    expect(history.getEntries()).toEqual(entries.slice(3))
    expect(persist).not.toHaveBeenCalled()
    history.restore(undefined)
    expect(history.getEntries()).toEqual([])
    history.restore({ entries })
    expect(history.getEntries()).toEqual([])
  })

  it('keeps repeated submissions and multiline text but ignores blank inputs', async () => {
    const persist = jest.fn(async () => undefined)
    const history = new InputHistory(persist)
    await history.append('first\nsecond')
    await history.append('first\nsecond')
    await history.append(' \n ')

    expect(history.getEntries()).toEqual(['first\nsecond', 'first\nsecond'])
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('retains in-memory history after a disk error and saves it on the next append', async () => {
    const persist = jest.fn(async () => undefined)
    persist.mockRejectedValueOnce(new Error('disk full'))
    const history = new InputHistory(persist)

    await expect(history.append('first')).rejects.toThrow('disk full')
    expect(history.getEntries()).toEqual(['first'])
    await history.append('second')
    expect(history.getEntries()).toEqual(['first', 'second'])
  })
})
