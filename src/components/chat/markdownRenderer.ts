import { type App, Component, MarkdownRenderer } from 'obsidian'

const STREAM_RENDER_INTERVAL_MS = 100

// An unfinished diagram is source code until its closing fence arrives.
// This avoids showing Mermaid syntax errors while tokens are still arriving.
export function prepareStreamingMarkdown(
  content: string,
  streaming: boolean,
): string {
  if (!streaming) return content

  const lines = content.split('\n')
  let fence: {
    marker: string
    length: number
    line: number
    mermaid: boolean
  } | null = null
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (!match) continue
    if (fence) {
      if (
        match[1][0] === fence.marker &&
        match[1].length >= fence.length &&
        !match[2].trim()
      ) {
        fence = null
      }
    } else {
      fence = {
        marker: match[1][0],
        length: match[1].length,
        line: index,
        mermaid: match[2].trim() === 'mermaid',
      }
    }
  }
  if (fence?.mermaid) {
    lines[fence.line] = lines[fence.line].replace('mermaid', 'text')
  }
  return lines.join('\n')
}

/** Serializes native renders and coalesces streaming updates without blanking the reply. */
export class ChatMarkdownRenderer {
  private latest: { content: string; streaming: boolean } | null = null
  private renderedSource: string | null = null
  private renderedComponent: Component | null = null
  private pendingComponent: Component | null = null
  private timer: number | null = null
  private readonly ownerWindow: Window
  private disposed = false

  constructor(
    private readonly app: App,
    private readonly container: HTMLElement,
    readonly sourcePath: string,
  ) {
    this.ownerWindow = container.ownerDocument.defaultView ?? window
  }

  update(content: string, streaming: boolean): void {
    if (this.disposed) return
    this.latest = { content, streaming }
    if (!streaming && this.timer !== null) {
      this.ownerWindow.clearTimeout(this.timer)
      this.timer = null
    }
    this.schedule()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) this.ownerWindow.clearTimeout(this.timer)
    this.renderedComponent?.unload()
    this.pendingComponent?.unload()
    this.container.replaceChildren()
  }

  private schedule(): void {
    if (
      this.disposed ||
      !this.latest ||
      this.pendingComponent ||
      this.timer !== null
    )
      return
    const source = prepareStreamingMarkdown(
      this.latest.content,
      this.latest.streaming,
    )
    if (source === this.renderedSource) return
    if (this.latest.streaming && this.renderedSource !== null) {
      this.timer = this.ownerWindow.setTimeout(() => {
        this.timer = null
        void this.render()
      }, STREAM_RENDER_INTERVAL_MS)
    } else {
      void this.render()
    }
  }

  private async render(): Promise<void> {
    if (this.disposed || !this.latest) return
    const { content, streaming } = this.latest
    const source = prepareStreamingMarkdown(content, streaming)
    const component = new Component()
    const stage = this.container.createDiv()
    stage.className = 'yolo-markdown-staging'
    stage.setAttribute('aria-hidden', 'true')
    // Keep the stage attached and measurable for diagrams and embedded content.
    this.pendingComponent = component
    component.load()
    let committed = false

    try {
      try {
        await MarkdownRenderer.render(
          this.app,
          source,
          stage,
          this.sourcePath,
          component,
        )
      } catch (error) {
        console.warn('[YOLO] Failed to render chat Markdown', error)
        stage.replaceChildren()
        stage.textContent = content
        stage.classList.add('yolo-markdown-fallback')
      }

      // A late render may finish after a replacement or unmount. Appended tokens
      // can still use this snapshot while the next render catches up.
      if (!this.disposed && this.latest.content.startsWith(content)) {
        this.renderedComponent?.unload()
        stage.classList.remove('yolo-markdown-staging')
        stage.removeAttribute('aria-hidden')
        this.container.replaceChildren(stage)
        this.renderedComponent = component
        this.renderedSource = source
        committed = true
      }
    } finally {
      if (!committed) {
        stage.remove()
        component.unload()
      }
      this.pendingComponent = null
      this.schedule()
    }
  }
}
