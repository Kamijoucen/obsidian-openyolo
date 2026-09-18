import { Keymap } from 'obsidian'
import { type MouseEvent, memo, useEffect, useRef } from 'react'

import { useApp } from '../../contexts/app-context'

import { ChatMarkdownRenderer } from './markdownRenderer'

type StreamingMarkdownProps = {
  content: string
  scale?: 'xs' | 'sm' | 'base'
  streaming?: boolean
}

const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  scale = 'base',
  streaming = false,
}: StreamingMarkdownProps) {
  const app = useApp()
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<ChatMarkdownRenderer | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new ChatMarkdownRenderer(
      app,
      container,
      app.workspace.getActiveFile()?.path ?? '',
    )
    rendererRef.current = renderer
    return () => {
      renderer.dispose()
      rendererRef.current = null
    }
  }, [app])

  useEffect(() => {
    rendererRef.current?.update(content, streaming)
  }, [app, content, streaming])

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0) return
    const target = event.target as HTMLElement
    const link = target.closest<HTMLAnchorElement>('a.internal-link')
    const href = link?.getAttribute('data-href') ?? link?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    void app.workspace.openLinkText(
      href,
      rendererRef.current?.sourcePath ?? '',
      Keymap.isModEvent(event.nativeEvent),
    )
  }

  return (
    <div
      ref={containerRef}
      className={`markdown-rendered yolo-markdown-rendered yolo-streaming-markdown yolo-scale-${scale}`}
      onClick={handleClick}
    />
  )
})

export default StreamingMarkdown
