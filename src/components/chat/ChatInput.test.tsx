/** @jest-environment jsdom */
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import ChatInput from './ChatInput'

jest.mock('../../contexts/input-history-context', () => ({
  useInputHistory: () => ({ getEntries: () => [] }),
}))
jest.mock('../../contexts/language-context', () => ({
  useLanguage: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('../../contexts/settings-context', () => ({
  useSettings: () => ({ settings: { attachCurrentNote: false } }),
}))
jest.mock('./NotePicker', () => ({ NotePicker: () => null }))
jest.mock('./selects', () => ({
  ConfigOptionSelect: () => null,
  ModeSelect: () => null,
  findConfigOption: () => null,
}))
jest.mock('./useActiveFile', () => ({ useActiveFile: () => null }))

describe('sending with pending image attachments', () => {
  let host: HTMLDivElement
  let root: Root
  let textarea: HTMLTextAreaElement
  let readers: FileReader[]
  const submit = jest.fn(async () => 'accepted' as const)

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    Object.defineProperty(HTMLTextAreaElement.prototype, 'setCssProps', {
      configurable: true,
      value: jest.fn(),
    })
    Object.defineProperties(URL, {
      createObjectURL: {
        configurable: true,
        value: jest
          .fn()
          .mockReturnValueOnce('blob:first')
          .mockReturnValueOnce('blob:second'),
      },
      revokeObjectURL: { configurable: true, value: jest.fn() },
    })
    readers = []
    jest
      .spyOn(FileReader.prototype, 'readAsDataURL')
      .mockImplementation(function (this: FileReader) {
        readers.push(this)
      })
    submit.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root.render(
        <ChatInput
          running={false}
          disabled={false}
          commands={[]}
          mode={null}
          configOptions={[]}
          onModeChange={jest.fn()}
          onConfigOptionChange={jest.fn()}
          onSubmit={submit}
          onCancel={jest.fn()}
        />,
      )
    })
    textarea = host.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(textarea, 'Test image attachment')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    jest.restoreAllMocks()
  })

  const sendButton = () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!

  function pasteImages(...names: string[]) {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    const items = names.map((name) => ({
      type: 'image/png',
      getAsFile: () => new File(['img'], name, { type: 'image/png' }),
    }))
    Object.defineProperty(event, 'clipboardData', { value: { items } })
    textarea.dispatchEvent(event)
  }

  function finishImage(reader: FileReader, data: string) {
    Object.defineProperty(reader, 'result', {
      value: `data:image/png;base64,${data}`,
    })
    reader.dispatchEvent(new Event('load'))
  }

  function pressEnter() {
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )
  }

  it('waits for every queued image before allowing either submission path', async () => {
    await act(async () => pasteImages('first.png', 'second.png'))
    expect(sendButton().disabled).toBe(true)
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'chat.imageReading',
    )
    await act(async () => {
      sendButton().click()
      pressEnter()
    })
    expect(submit).not.toHaveBeenCalled()

    await act(async () => finishImage(readers[0], 'Zmlyc3Q='))
    expect(sendButton().disabled).toBe(true)

    await act(async () => finishImage(readers[1], 'c2Vjb25k'))
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(sendButton().disabled).toBe(false)
    await act(async () => pressEnter())
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith(
      'Test image attachment',
      [
        expect.objectContaining({ data: 'Zmlyc3Q=' }),
        expect.objectContaining({ data: 'c2Vjb25k' }),
      ],
      [],
    )
  })

  it('releases the send button and shows the read error when the image fails', async () => {
    await act(async () => pasteImages('failed.png'))
    expect(sendButton().disabled).toBe(true)
    await act(async () => readers[0].dispatchEvent(new Event('error')))
    expect(sendButton().disabled).toBe(false)
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'Could not read the selected image.',
    )
    expect(submit).not.toHaveBeenCalled()
  })
})
