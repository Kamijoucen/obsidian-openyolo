import type { App, PluginManifest } from 'obsidian'

import YoloPlugin from './main'

jest.mock('./ChatView', () => ({ ChatView: class {} }))
jest.mock('./i18n', () => ({ getUiLanguage: () => 'en' }))
jest.mock('obsidian', () => ({
  ...jest.requireActual('../__mocks__/obsidian'),
  Plugin: class {
    loadData = jest.fn(async () => ({}))
    saveData = jest.fn(async () => undefined)
  },
}))

function createPlugin() {
  return new YoloPlugin({} as App, {} as PluginManifest)
}

describe('plugin input history persistence', () => {
  it('loads history independently of session state and saves it alongside settings', async () => {
    const plugin = createPlugin()
    const save = jest.spyOn(plugin, 'saveData')
    jest.spyOn(plugin, 'loadData').mockResolvedValue({
      showReasoning: false,
      inputHistory: ['from another session'],
    })
    await plugin.loadSettings()

    expect(plugin.inputHistory.getEntries()).toEqual(['from another session'])
    await plugin.inputHistory.append('new question')
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        showReasoning: false,
        inputHistory: ['from another session', 'new question'],
      }),
    )

    await plugin.saveSettings({ ...plugin.settings, showReasoning: true })
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        showReasoning: true,
        inputHistory: ['from another session', 'new question'],
      }),
    )
  })

  it('serializes settings and history writes with coherent snapshots', async () => {
    const plugin = createPlugin()
    await plugin.loadSettings()
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const save = jest
      .spyOn(plugin, 'saveData')
      .mockImplementationOnce(() => pending)

    const first = plugin.inputHistory.append('first')
    const settings = plugin.saveSettings({
      ...plugin.settings,
      showReasoning: false,
    })
    const second = plugin.inputHistory.append('second')
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toMatchObject({ inputHistory: ['first'] })

    release()
    await Promise.all([first, settings, second])
    expect(save).toHaveBeenCalledTimes(3)
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        showReasoning: false,
        inputHistory: ['first', 'second'],
      }),
    )

    const reloaded = createPlugin()
    jest.spyOn(reloaded, 'loadData').mockResolvedValue(save.mock.calls[2][0])
    await reloaded.loadSettings()
    expect(reloaded.inputHistory.getEntries()).toEqual(['first', 'second'])
    expect(reloaded.settings.showReasoning).toBe(false)
  })
})
