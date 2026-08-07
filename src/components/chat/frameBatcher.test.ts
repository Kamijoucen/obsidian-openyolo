import { FrameBatcher } from './frameBatcher'

describe('FrameBatcher', () => {
  it('emits only the newest value in a frame', () => {
    const callbacks: FrameRequestCallback[] = []
    const emit = jest.fn()
    const batcher = new FrameBatcher<number>(
      (callback) => {
        callbacks.push(callback)
        return callbacks.length
      },
      () => undefined,
      emit,
    )

    batcher.push(1)
    batcher.push(2)
    batcher.push(3)

    expect(callbacks).toHaveLength(1)
    callbacks[0](0)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(3)
  })

  it('cancels a scheduled update when disposed', () => {
    const cancel = jest.fn()
    const emit = jest.fn()
    const batcher = new FrameBatcher<number>(() => 42, cancel, emit)

    batcher.push(1)
    batcher.dispose()

    expect(cancel).toHaveBeenCalledWith(42)
    expect(emit).not.toHaveBeenCalled()
  })
})
