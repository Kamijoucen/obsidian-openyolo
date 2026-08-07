import { PromptDraftController } from './promptDraft'

describe('PromptDraftController', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('debounces a draft and commits the latest value', async () => {
    const commit = jest.fn(async () => undefined)
    const controller = new PromptDraftController(600, commit)

    controller.set('first')
    controller.set('second')
    jest.advanceTimersByTime(599)
    expect(commit).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(1)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('second')
  })

  it('flushes immediately when the settings UI is rebuilt', async () => {
    const commit = jest.fn(async () => undefined)
    const controller = new PromptDraftController(600, commit)
    controller.set('unsaved input')

    await controller.flush()

    expect(commit).toHaveBeenCalledWith('unsaved input')
    expect(controller.value('persisted')).toBe('persisted')
  })

  it('does not clear a newer draft when an older commit finishes', async () => {
    let resolveFirst!: () => void
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const commit = jest
      .fn<Promise<void>, [string]>()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined)
    const controller = new PromptDraftController(600, commit)

    controller.set('first')
    const flushing = controller.flush()
    controller.set('second')
    resolveFirst()
    await flushing

    expect(controller.value('persisted')).toBe('second')
    await controller.flush()
    expect(commit).toHaveBeenNthCalledWith(2, 'second')
  })
})
