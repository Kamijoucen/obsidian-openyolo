/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
/* eslint-disable @typescript-eslint/unbound-method -- Jest assertions inspect mocked methods without invoking them. */
import { type App, type EventRef, MarkdownRenderer } from 'obsidian'

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
  let timeline: HTMLElement | null
  const listeners = new Map<EventRef, () => void>()
  const workspace = {
    on: jest.fn((_name: string, callback: () => void) => {
      const ref = {} as EventRef
      listeners.set(ref, callback)
      return ref
    }),
    offref: jest.fn((ref: EventRef) => {
      listeners.delete(ref)
    }),
  }
  const app = { workspace } as unknown as App
  const changeProcessors = () => {
    ;[...listeners.values()].forEach((callback) => callback())
  }

  beforeEach(() => {
    jest.useFakeTimers()
    timeline = null
    listeners.clear()
    workspace.on.mockClear()
    workspace.offref.mockClear()
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
    timeline?.remove()
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

  it('replaces the trust prompt as soon as Allow triggers a processor change, without new text', async () => {
    let trusted = false
    nativeRender.mockImplementation(async (_app, _source, stage) => {
      if (trusted) {
        stage.appendChild(
          document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
        )
      } else {
        const allow = stage.appendChild(document.createElement('button'))
        allow.textContent = 'Allow'
        allow.addEventListener('click', () => {
          trusted = true
          changeProcessors()
        })
      }
    })
    const source = '```mermaid\ngraph LR\nA --> B\n```'
    renderer.update(source, false)
    await flush()
    const oldOwner = nativeRender.mock.calls[0][4]
    expect(workspace.on).toHaveBeenCalledWith(
      'post-processor-change',
      expect.any(Function),
    )
    host.querySelector('button')!.click()
    await flush()
    expect(host.querySelector('button')).toBeNull()
    expect(host.querySelector('svg')).not.toBeNull()
    expect(nativeRender.mock.calls.map((call) => call[1])).toEqual([
      source,
      source,
    ])
    expect(oldOwner.unload).toHaveBeenCalledTimes(1)
    renderer.update(source, false)
    expect(nativeRender).toHaveBeenCalledTimes(2)
  })

  it('discards an in-flight render invalidated by a processor change and renders the latest text', async () => {
    let finish!: () => void
    nativeRender.mockImplementationOnce(async (_app, _source, stage) => {
      stage.textContent = 'Stale trust prompt'
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    renderer.update('Diagram', true)
    const staleStage = nativeRender.mock.calls[0][2]
    const staleOwner = nativeRender.mock.calls[0][4]
    changeProcessors()
    changeProcessors()
    renderer.update('Diagram and new text', false)
    expect(nativeRender).toHaveBeenCalledTimes(1)
    finish()
    await flush()
    expect(staleStage.isConnected).toBe(false)
    expect(staleOwner.unload).toHaveBeenCalled()
    expect(host.textContent).toBe('Diagram and new text')
    expect(nativeRender).toHaveBeenCalledTimes(2)
  })

  it('refreshes identical streaming content and cancels queued refreshes on disposal', async () => {
    renderer.update('Streaming diagram', true)
    await flush()
    changeProcessors()
    await jest.advanceTimersByTimeAsync(100)
    expect(nativeRender).toHaveBeenCalledTimes(2)
    changeProcessors()
    renderer.dispose()
    changeProcessors()
    await jest.runAllTimersAsync()
    expect(workspace.offref).toHaveBeenCalledWith(
      workspace.on.mock.results[0].value,
    )
    expect(listeners.size).toBe(0)
    expect(nativeRender).toHaveBeenCalledTimes(2)
    expect(host.children).toHaveLength(0)
  })

  it('navigates both footnote directions within this reply and updates scroll following', async () => {
    timeline = document.createElement('div')
    timeline.className = 'yolo-chat-messages'
    document.body.appendChild(timeline)
    timeline.appendChild(host)
    Object.defineProperty(timeline, 'clientHeight', { value: 200 })
    timeline.getBoundingClientRect = () => ({ top: 20 }) as DOMRect
    const onScroll = jest.fn()
    timeline.addEventListener('scroll', onScroll)
    nativeRender.mockImplementation(async (_app, _source, stage) => {
      const reference = stage.appendChild(document.createElement('sup'))
      reference.dataset.footnoteId = reference.id = 'fnref-1-doc'
      const forward = reference.appendChild(document.createElement('a'))
      forward.className = 'footnote-link'
      forward.href = '#fn-1-doc'
      forward.textContent = '[1]'
      const definition = stage.appendChild(document.createElement('div'))
      definition.dataset.footnoteId = definition.id = 'fn-1-doc'
      const back = definition.appendChild(document.createElement('a'))
      back.className = 'footnote-backref footnote-link'
      back.href = '#fnref-1-doc'
      back.appendChild(document.createElement('span')).textContent = '↩'
      reference.getBoundingClientRect = () =>
        ({ top: 120 - timeline!.scrollTop, height: 20 }) as DOMRect
      definition.getBoundingClientRect = () =>
        ({ top: 920 - timeline!.scrollTop, height: 20 }) as DOMRect
    })
    renderer.update('Reply with a footnote', false)
    await flush()
    timeline.scrollTop = 300
    // Another reply can have a matching identifier; it must never be selected.
    const otherReference = document.createElement('sup')
    otherReference.id = 'fnref-1-doc'
    timeline.prepend(otherReference)
    const footnote = host.querySelector<HTMLElement>('[id="fn-1-doc"]')!
    const reference = host.querySelector<HTMLElement>('[id="fnref-1-doc"]')!
    const forward = new MouseEvent('click', { bubbles: true, cancelable: true })
    host.querySelector('a')!.dispatchEvent(forward)
    expect(forward.defaultPrevented).toBe(true)
    expect(timeline.scrollTop).toBe(810)
    expect(document.activeElement).toBe(footnote)
    host.querySelector<HTMLSpanElement>('a.footnote-backref span')!.click()
    expect(timeline.scrollTop).toBe(10)
    expect(document.activeElement).toBe(reference)
    expect(onScroll).toHaveBeenCalledTimes(2)
  })

  it('resolves encoded footnote IDs without treating their contents as CSS selectors', async () => {
    const id = 'fnref-中文:1[2]-doc'
    const scroll = jest.fn()
    nativeRender.mockImplementation(async (_app, _source, stage) => {
      const reference = stage.appendChild(document.createElement('sup'))
      reference.id = id
      reference.scrollIntoView = scroll
      const back = stage.appendChild(document.createElement('a'))
      back.className = 'footnote-backref'
      back.href = `#${encodeURIComponent(id)}`
    })
    renderer.update('Encoded footnote', false)
    await flush()
    host.querySelector('a')!.click()
    expect(scroll).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'instant',
    })
  })

  it('does not fall through to page navigation when a footnote target is missing', async () => {
    nativeRender.mockImplementation(async (_app, _source, stage) => {
      const back = stage.appendChild(document.createElement('a'))
      back.className = 'footnote-backref'
      back.href = '#fnref-missing%'
    })
    renderer.update('Missing reference', false)
    await flush()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(() => host.querySelector('a')!.dispatchEvent(click)).not.toThrow()
    expect(click.defaultPrevented).toBe(true)
  })

  it('removes the footnote handler when the reply is disposed', async () => {
    const remove = jest.spyOn(host, 'removeEventListener')
    renderer.update('Reply', false)
    await flush()
    renderer.dispose()
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function))
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
