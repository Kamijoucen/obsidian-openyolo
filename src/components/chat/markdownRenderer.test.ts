/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions inspect mocked methods without invoking them. */
import { type App, MarkdownRenderer } from 'obsidian'

import {
  ChatMarkdownRenderer,
  prepareStreamingMarkdown,
} from './markdownRenderer'

const nativeRender = jest.mocked(MarkdownRenderer.render)
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ChatMarkdownRenderer', () => {
  let host: HTMLElement
  let renderer: ChatMarkdownRenderer
  const app = {} as App

  beforeEach(() => {
    jest.useFakeTimers()
    nativeRender.mockReset()
    nativeRender.mockImplementation(async (_app, source, element) => {
      element.textContent = source
    })
    host = document.createElement('div')
    host.createDiv = () => host.appendChild(document.createElement('div'))
    document.body.appendChild(host)
    renderer = new ChatMarkdownRenderer(app, host, 'Notes/Context.md')
  })

  afterEach(() => {
    renderer.dispose()
    host.remove()
    jest.useRealTimers()
  })

  it('passes Obsidian syntax unchanged to the native renderer with a loaded owner and source path', async () => {
    const source = [
      '> [!tip] 提示\n> **中文**',
      '行内公式：$E = mc^2$',
      '$$ \\sum_{i=1}^{n} i = \\frac{n(n+1)}{2} $$',
      '```mermaid\ngraph LR\n A[用户输入] --> B{AI 插件}\n```',
      '[[测试笔记|别名]] ![[image.png]] ==高亮==',
      '- [x] 完成\n\n| A | B |\n|---|---|\n| 1 | 2 |',
      '`$literal$`\n\n```js\nconst dollar = "$$"\n```',
    ].join('\n\n')

    renderer.update(source, false)
    const [, actualSource, stage, path, owner] = nativeRender.mock.calls[0]
    expect(actualSource).toBe(source)
    expect(nativeRender.mock.calls[0][0]).toBe(app)
    expect(path).toBe('Notes/Context.md')
    expect(owner.load).toHaveBeenCalledTimes(1)
    expect(stage.isConnected).toBe(true)
    expect(stage.getAttribute('aria-hidden')).toBe('true')
    await flush()
    expect(host.firstElementChild).toBe(stage)
    expect(stage.hasAttribute('aria-hidden')).toBe(false)
    expect(stage.classList.contains('yolo-markdown-staging')).toBe(false)
  })

  it('coalesces continuous tokens without delaying the final reply', async () => {
    renderer.update('A', true)
    await flush()
    renderer.update('AB', true)
    renderer.update('ABC', true)
    expect(nativeRender).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(100)
    expect(nativeRender).toHaveBeenCalledTimes(2)
    expect(host.textContent).toBe('ABC')
    renderer.update('ABCD', true)
    renderer.update('ABCDE', false)
    await flush()
    expect(nativeRender).toHaveBeenCalledTimes(3)
    expect(host.textContent).toBe('ABCDE')
    expect(jest.getTimerCount()).toBe(0)
    renderer.update('ABCDE', false)
    expect(nativeRender).toHaveBeenCalledTimes(3)
  })

  it('keeps the previous DOM until rendering finishes and releases its resources on replacement', async () => {
    renderer.update('Before', false)
    await flush()
    const oldStage = host.firstElementChild
    const oldOwner = nativeRender.mock.calls[0][4]
    let finish!: () => void
    nativeRender.mockImplementationOnce(async (_app, source, stage) => {
      stage.textContent = source
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    renderer.update('After', false)
    expect(oldStage?.isConnected).toBe(true)
    expect(oldOwner.unload).not.toHaveBeenCalled()
    finish()
    await flush()
    expect(oldStage?.isConnected).toBe(false)
    expect(host.textContent).toBe('After')
    expect(oldOwner.unload).toHaveBeenCalledTimes(1)
  })

  it('serializes slow renders and never commits a superseded reply', async () => {
    let finish!: () => void
    nativeRender.mockImplementationOnce(async (_app, source, stage) => {
      stage.textContent = source
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    renderer.update('Old reply', true)
    const staleOwner = nativeRender.mock.calls[0][4]
    renderer.update('New reply', false)
    expect(nativeRender).toHaveBeenCalledTimes(1)
    finish()
    await flush()
    expect(staleOwner.unload).toHaveBeenCalled()
    expect(nativeRender).toHaveBeenCalledTimes(2)
    expect(host.textContent).toBe('New reply')
    expect(host.children).toHaveLength(1)
  })

  it('releases in-flight renders and does not repopulate an unmounted host', async () => {
    let finish!: () => void
    nativeRender.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    renderer.update('Slow diagram', false)
    const owner = nativeRender.mock.calls[0][4]
    renderer.dispose()
    expect(owner.unload).toHaveBeenCalled()
    finish()
    await flush()
    renderer.update('Ignored', false)
    expect(host.children).toHaveLength(0)
    expect(nativeRender).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('cancels queued streaming renders on disposal', async () => {
    renderer.update('A', true)
    await flush()
    const owner = nativeRender.mock.calls[0][4]
    renderer.update('AB', true)
    renderer.dispose()
    await jest.runAllTimersAsync()
    expect(owner.unload).toHaveBeenCalled()
    expect(nativeRender).toHaveBeenCalledTimes(1)
  })

  it('falls back to literal text after a renderer error and can render the next update', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    nativeRender.mockRejectedValueOnce(new Error('Render failed'))
    renderer.update('<script>alert(1)</script>', false)
    await flush()
    expect(host.textContent).toBe('<script>alert(1)</script>')
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('.yolo-markdown-fallback')).not.toBeNull()
    expect(nativeRender).toHaveBeenCalledTimes(1)
    renderer.update('Recovered', false)
    await flush()
    expect(host.textContent).toBe('Recovered')
    warn.mockRestore()
  })
})

/* eslint-enable @typescript-eslint/unbound-method -- Remaining tests do not inspect mock methods. */

describe('prepareStreamingMarkdown', () => {
  it.each(['```', '~~~'])(
    'defers an incomplete %s Mermaid fence until it closes',
    (fence) => {
      const source = `${fence}mermaid\ngraph LR\nA --> B`
      expect(prepareStreamingMarkdown(source, true)).toBe(
        source.replace('mermaid', 'text'),
      )
      expect(prepareStreamingMarkdown(`${source}\n${fence}`, true)).toBe(
        `${source}\n${fence}`,
      )
      expect(prepareStreamingMarkdown(source, false)).toBe(source)
    },
  )

  it('does not treat fence examples inside another code block as diagrams', () => {
    const source = '````markdown\n```mermaid\ngraph LR\nA --> B\n```\n````'
    expect(prepareStreamingMarkdown(source, true)).toBe(source)
  })

  it('preserves completed diagrams when the following diagram is incomplete', () => {
    const complete = '```mermaid\ngraph LR\nA --> B\n```\n\n'
    expect(
      prepareStreamingMarkdown(`${complete}\`\`\`mermaid\ngraph LR`, true),
    ).toBe(`${complete}\`\`\`text\ngraph LR`)
  })
})
