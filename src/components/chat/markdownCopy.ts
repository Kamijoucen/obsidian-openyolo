import {
  type MarkdownPostProcessor,
  MarkdownRenderChild,
  Notice,
  setIcon,
} from 'obsidian'

import { t } from '../../i18n'

function mermaidMarkdown(source: string): string {
  const longestFence = Math.max(
    0,
    ...Array.from(source.matchAll(/`+/g), (match) => match[0].length),
  )
  const fence = '`'.repeat(Math.max(3, longestFence + 1))
  return `${fence}mermaid\n${source.replace(/\n$/, '')}\n${fence}`
}

// Run before Obsidian's math/diagram processors replace source text with DOM.
// Wrappers survive those replacements, including deferred Mermaid rendering.
export const addMarkdownCopyButtons: MarkdownPostProcessor = (
  element,
  context,
) => {
  if (!element.classList.contains('yolo-markdown-staging')) return
  const targets = element.querySelectorAll<HTMLElement>(
    'pre > code.language-mermaid, .math:not(.is-loaded)',
  )
  if (targets.length === 0) return

  const owner = new MarkdownRenderChild(element)
  const ownerWindow = element.ownerDocument.defaultView ?? window
  const timers = new Set<number>()
  let disposed = false
  owner.register(() => {
    disposed = true
    timers.forEach((timer) => ownerWindow.clearTimeout(timer))
  })
  context.addChild(owner)

  targets.forEach((target) => {
    if (target.closest('.yolo-markdown-copy')) return
    const isDiagram = target.matches('code.language-mermaid')
    const inline = !isDiagram && target.classList.contains('math-inline')
    const source = target.textContent ?? ''
    const markdown = isDiagram
      ? mermaidMarkdown(source)
      : inline
        ? `$${source}$`
        : `$$\n${source}\n$$`
    const content = isDiagram ? target.parentElement : target
    if (!content?.parentElement) return
    const wrapper =
      content.tagName === 'SPAN' ? element.createSpan() : element.createDiv()
    wrapper.className = `yolo-markdown-copy ${inline ? 'yolo-markdown-copy-inline' : 'yolo-markdown-copy-block'}`
    content.before(wrapper)
    wrapper.appendChild(content)
    const button = wrapper.createEl('button', {
      cls: 'yolo-markdown-copy-button',
      attr: { type: 'button' },
    })
    const icon = button.createSpan({ attr: { 'aria-hidden': 'true' } })
    const label = inline ? null : button.createSpan()
    const title = isDiagram
      ? t('chat.copyDiagram', 'Copy diagram source')
      : t('chat.copyFormula', 'Copy formula source')
    const reset = () => {
      setIcon(icon, 'copy')
      button.setAttribute('aria-label', title)
      button.title = title
      button.classList.remove('is-copied')
      if (label) label.textContent = t('chat.copy', 'Copy')
    }
    reset()
    let copying = false
    let resetTimer: number | null = null
    owner.registerDomEvent(button, 'click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (copying || disposed) return
      copying = true
      try {
        await ownerWindow.navigator.clipboard.writeText(markdown)
        if (disposed) return
        setIcon(icon, 'check')
        const copied = t('chat.copied', 'Copied')
        button.setAttribute('aria-label', copied)
        button.title = copied
        button.classList.add('is-copied')
        if (label) label.textContent = copied
        if (resetTimer !== null) {
          ownerWindow.clearTimeout(resetTimer)
          timers.delete(resetTimer)
        }
        resetTimer = ownerWindow.setTimeout(() => {
          if (resetTimer !== null) timers.delete(resetTimer)
          resetTimer = null
          reset()
        }, 1500)
        timers.add(resetTimer)
      } catch (error) {
        if (!disposed) {
          console.warn('[YOLO] Failed to copy Markdown source', error)
          new Notice(t('chat.copyFailed', 'Could not copy. Please try again.'))
        }
      } finally {
        copying = false
      }
    })
  })
}
