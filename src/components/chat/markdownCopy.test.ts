/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
import {
  type MarkdownPostProcessorContext,
  type MarkdownRenderChild,
  Notice,
} from 'obsidian'

import { addMarkdownCopyButtons } from './markdownCopy'

jest.mock('obsidian', () => ({
  MarkdownRenderChild: class {
    callbacks: (() => void)[] = []
    register(callback: () => void) {
      this.callbacks.push(callback)
    }
    registerDomEvent(
      element: HTMLElement,
      type: string,
      handler: EventListener,
    ) {
      element.addEventListener(type, handler)
      this.register(() => element.removeEventListener(type, handler))
    }
    unload() {
      this.callbacks.splice(0).forEach((callback) => callback())
    }
  },
  setIcon: jest.fn((element: HTMLElement, icon: string) => {
    element.dataset.icon = icon
  }),
  Notice: jest.fn(),
}))
jest.mock('../../i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}))

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('chat Markdown copy buttons', () => {
  let host: HTMLElement
  let owners: MarkdownRenderChild[]
  let context: MarkdownPostProcessorContext
  const writeText = jest.fn<Promise<void>, [string]>()

  beforeAll(() => {
    function createEl(
      this: HTMLElement,
      tag: string,
      options?: { cls?: string; attr?: Record<string, string> },
    ) {
      const element = this.ownerDocument.createElement(tag)
      if (options?.cls) element.className = options.cls
      Object.entries(options?.attr ?? {}).forEach(([key, value]) =>
        element.setAttribute(key, value),
      )
      this.appendChild(element)
      return element
    }
    Object.defineProperties(HTMLElement.prototype, {
      createEl: { configurable: true, value: createEl },
      createDiv: {
        configurable: true,
        value: function (this: HTMLElement) {
          return createEl.call(this, 'div')
        },
      },
      createSpan: {
        configurable: true,
        value: function (
          this: HTMLElement,
          options?: { attr?: Record<string, string> },
        ) {
          return createEl.call(this, 'span', options)
        },
      },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  afterAll(() => {
    for (const key of ['createEl', 'createDiv', 'createSpan'])
      Reflect.deleteProperty(HTMLElement.prototype, key)
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  beforeEach(() => {
    jest.useFakeTimers()
    writeText.mockReset().mockResolvedValue(undefined)
    jest.mocked(Notice).mockClear()
    host = document.createElement('div')
    host.className = 'yolo-markdown-staging'
    document.body.appendChild(host)
    owners = []
    context = {
      addChild: (owner: MarkdownRenderChild) => {
        owners.push(owner)
      },
    } as unknown as MarkdownPostProcessorContext
  })

  afterEach(() => {
    owners.forEach((owner) => owner.unload())
    host.remove()
    jest.useRealTimers()
  })

  function math(source: string, inline = false) {
    const element = document.createElement(inline ? 'span' : 'div')
    element.className = `math ${inline ? 'math-inline' : 'math-block'}`
    element.textContent = source
    host.appendChild(element)
    return element
  }

  function code(source: string, language = 'mermaid') {
    const pre = host.appendChild(document.createElement('pre'))
    const element = pre.appendChild(document.createElement('code'))
    element.className = `language-${language}`
    element.textContent = source
    return element
  }

  it('copies a complete Mermaid Markdown block even after the source becomes an SVG', async () => {
    const source = 'graph LR\n A[用户输入] --> B{AI 插件}\n'
    const element = code(source)
    addMarkdownCopyButtons(host, context)
    element.parentElement!.replaceWith(
      document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    )
    host.querySelector('button')!.click()
    await flush()
    expect(writeText).toHaveBeenCalledWith(`\`\`\`mermaid\n${source}\`\`\``)
    expect(host.querySelector('button')!.textContent).toBe('Copied')
    await jest.advanceTimersByTimeAsync(1500)
    expect(host.querySelector('button')!.textContent).toBe('Copy')
  })

  it.each([false, true])(
    'copies the original formula and its delimiters (inline=%s)',
    async (inline) => {
      const source = '\\frac{a < b}{c & d}'
      const element = math(source, inline)
      addMarkdownCopyButtons(host, context)
      element.textContent = 'Rendered MathJax output'
      host.querySelector('button')!.click()
      await flush()
      expect(writeText).toHaveBeenCalledWith(
        inline ? `$${source}$` : `$$\n${source}\n$$`,
      )
    },
  )

  it('keeps formulas and diagrams paired with their own source', async () => {
    math('x', true)
    code('graph LR\nA --> B')
    math('y^2')
    addMarkdownCopyButtons(host, context)
    host.querySelectorAll('button').forEach((button) => button.click())
    await flush()
    expect(writeText.mock.calls.map(([source]) => source)).toEqual([
      '$x$',
      '```mermaid\ngraph LR\nA --> B\n```',
      '$$\ny^2\n$$',
    ])
  })

  it('uses a longer fence when a diagram contains literal backticks', async () => {
    code('graph LR\nA["```"] --> B')
    addMarkdownCopyButtons(host, context)
    host.querySelector('button')!.click()
    await flush()
    expect(writeText).toHaveBeenCalledWith(
      '````mermaid\ngraph LR\nA["```"] --> B\n````',
    )
  })

  it('leaves note rendering and ordinary code blocks untouched', () => {
    math('x')
    host.className = 'markdown-rendered'
    addMarkdownCopyButtons(host, context)
    expect(host.querySelector('button')).toBeNull()
    expect(owners).toHaveLength(0)
    host.replaceChildren()
    host.className = 'yolo-markdown-staging'
    code('$x$\n```mermaid', 'text')
    addMarkdownCopyButtons(host, context)
    expect(host.querySelector('button')).toBeNull()
  })

  it('does not add duplicate buttons when post-processing repeats', () => {
    math('x')
    code('graph LR\nA --> B')
    addMarkdownCopyButtons(host, context)
    addMarkdownCopyButtons(host, context)
    expect(host.querySelectorAll('button')).toHaveLength(2)
  })

  it('reports clipboard failure without showing success and allows retry', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    math('x')
    addMarkdownCopyButtons(host, context)
    const button = host.querySelector('button')!
    button.click()
    await flush()
    expect(Notice).toHaveBeenCalledWith('Could not copy. Please try again.')
    expect(button.textContent).toBe('Copy')
    button.click()
    await flush()
    expect(button.textContent).toBe('Copied')
    warn.mockRestore()
  })

  it('ignores repeated clicks while copying and releases listeners and timers on unload', async () => {
    let finish!: () => void
    writeText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    math('x')
    addMarkdownCopyButtons(host, context)
    const button = host.querySelector('button')!
    button.click()
    button.click()
    expect(writeText).toHaveBeenCalledTimes(1)
    owners.forEach((owner) => owner.unload())
    finish()
    await flush()
    button.click()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
    expect(button.textContent).toBe('Copy')
  })
})
