import type { App } from 'obsidian'

import type YoloPlugin from '../main'

import { YoloSettingTab } from './SettingTab'

describe('YoloSettingTab lifecycle', () => {
  it('subscribes once and disposes the availability listener idempotently', () => {
    const listeners = new Set<() => void>()
    const unsubscribe = jest.fn()
    const onAvailabilityChange = jest.fn((listener: () => void) => {
      listeners.add(listener)
      return () => {
        unsubscribe()
        listeners.delete(listener)
      }
    })
    const plugin = {
      getSessionService: () => ({ onAvailabilityChange }),
    } as unknown as YoloPlugin
    const tab = new YoloSettingTab({} as App, plugin)
    const update = jest.spyOn(tab, 'update')

    expect(onAvailabilityChange).toHaveBeenCalledTimes(1)
    listeners.forEach((listener) => listener())
    expect(update).toHaveBeenCalledTimes(1)

    tab.dispose()
    tab.dispose()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
    listeners.forEach((listener) => listener())
    expect(update).toHaveBeenCalledTimes(1)
  })
})
