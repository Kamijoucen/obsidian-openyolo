import { Keymap } from 'obsidian'
import {
  Children,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { useApp } from '../../contexts/app-context'

import {
  remarkObsidianWikilinks,
  wikilinkTargetFromHref,
} from './obsidianMarkdown'
import {
  normalizeDisplayMathDelimiters,
  preserveUnclosedMathSource,
  renderStreamingMath,
} from './streamingMath'

type StreamingMarkdownProps = {
  content: string
  scale?: 'xs' | 'sm' | 'base'
  animateIncrementalText?: boolean
}

function isExternalHref(href: string): boolean {
  return /^(https?:)?\/\//.test(href)
}

function getNextRevealIndex(
  currentContent: string,
  targetContent: string,
  maxStep: number,
): number {
  const baseNextIndex = Math.min(
    targetContent.length,
    currentContent.length + Math.max(1, maxStep),
  )

  if (baseNextIndex >= targetContent.length) {
    return targetContent.length
  }

  const lookaheadSlice = targetContent.slice(baseNextIndex, baseNextIndex + 12)
  const boundaryOffset = lookaheadSlice.search(
    /[\s,.!?;:，。！？；：、】【」』》）)}\]]/,
  )

  if (boundaryOffset >= 0) {
    return Math.min(targetContent.length, baseNextIndex + boundaryOffset + 1)
  }

  return baseNextIndex
}

type ElementWithClassName = ReactElement<{ className?: string }>

function hasMathClass(className: string | undefined, name: string): boolean {
  return className?.split(/\s+/).includes(name) ?? false
}

function getTextContent(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : '',
    )
    .join('')
}

const StreamingMath = memo(function StreamingMath({
  source,
  display,
}: {
  source: string
  display: boolean
}) {
  const setContainer = useCallback(
    (container: HTMLElement | null) => {
      if (container) {
        renderStreamingMath(container, source, display)
      }
    },
    [display, source],
  )
  const rawSource = display ? `$$\n${source}\n$$` : `$${source}$`

  return display ? (
    <div
      ref={setContainer}
      className="yolo-streaming-math yolo-streaming-math-display"
    >
      {rawSource}
    </div>
  ) : (
    <span
      ref={setContainer}
      className="yolo-streaming-math yolo-streaming-math-inline"
    >
      {rawSource}
    </span>
  )
})

function StreamingCode({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'code'>) {
  if (
    hasMathClass(className, 'math-inline') ||
    hasMathClass(className, 'math-display')
  ) {
    return (
      <StreamingMath
        source={getTextContent(children).replace(/\n$/, '')}
        display={hasMathClass(className, 'math-display')}
      />
    )
  }

  return (
    <code {...props} className={className}>
      {children}
    </code>
  )
}

function StreamingPre({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const child = isValidElement(children)
    ? (children as ElementWithClassName)
    : null
  if (hasMathClass(child?.props.className, 'math-display')) {
    return <>{children}</>
  }

  return <pre {...props}>{children}</pre>
}

const StreamingMarkdown = memo(function StreamingMarkdown({
  content,
  scale = 'base',
  animateIncrementalText = false,
}: StreamingMarkdownProps) {
  const app = useApp()
  const [displayedContent, setDisplayedContent] = useState(content)
  const displayedContentRef = useRef(content)
  const targetContentRef = useRef(content)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)

  const handleInternalLinkClick = useCallback(
    (href: string, event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
      const wikilinkTarget = wikilinkTargetFromHref(href)
      void app.workspace.openLinkText(
        wikilinkTarget ?? href,
        app.workspace.getActiveFile()?.path ?? '',
        Keymap.isModEvent(event.nativeEvent),
      )
    },
    [app],
  )

  const cancelRevealAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    lastFrameTimeRef.current = null
  }, [])

  const scheduleRevealAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return
    }

    const tick = (timestamp: number) => {
      const target = targetContentRef.current
      const current = displayedContentRef.current
      const backlog = target.length - current.length

      if (backlog <= 0) {
        animationFrameRef.current = null
        lastFrameTimeRef.current = null
        return
      }

      const elapsedMs = lastFrameTimeRef.current
        ? Math.min(64, timestamp - lastFrameTimeRef.current)
        : 16
      lastFrameTimeRef.current = timestamp

      const charsPerSecond = Math.min(900, 90 + backlog * 4)
      const maxStep = Math.max(
        1,
        Math.floor((charsPerSecond * elapsedMs) / 1000),
      )
      const nextRevealIndex = getNextRevealIndex(current, target, maxStep)
      const nextContent = target.slice(0, nextRevealIndex)

      if (nextContent !== current) {
        displayedContentRef.current = nextContent
        setDisplayedContent(nextContent)
      }

      animationFrameRef.current =
        nextRevealIndex < target.length
          ? window.requestAnimationFrame(tick)
          : null

      if (nextRevealIndex >= target.length) {
        lastFrameTimeRef.current = null
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    if (!animateIncrementalText) {
      cancelRevealAnimation()
      displayedContentRef.current = content
      targetContentRef.current = content
      setDisplayedContent(content)
      return
    }

    const currentDisplayed = displayedContentRef.current
    if (
      content.length < currentDisplayed.length ||
      !content.startsWith(currentDisplayed)
    ) {
      cancelRevealAnimation()
      displayedContentRef.current = content
      targetContentRef.current = content
      setDisplayedContent(content)
      return
    }

    targetContentRef.current = content
    scheduleRevealAnimation()
  }, [
    animateIncrementalText,
    cancelRevealAnimation,
    content,
    scheduleRevealAnimation,
  ])

  useEffect(() => {
    return () => {
      cancelRevealAnimation()
    }
  }, [cancelRevealAnimation])

  return (
    <div
      className={`markdown-rendered yolo-markdown-rendered yolo-streaming-markdown yolo-scale-${scale}`}
    >
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkMath,
          preserveUnclosedMathSource,
          remarkObsidianWikilinks,
        ]}
        skipHtml
        components={{
          code: StreamingCode,
          pre: StreamingPre,
          a: ({ href, children, ...props }) => {
            if (!href) {
              return <a {...props}>{children}</a>
            }

            if (isExternalHref(href)) {
              return (
                <a {...props} href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              )
            }

            return (
              <a
                {...props}
                href={href}
                className="internal-link"
                onClick={(event) => {
                  void handleInternalLinkClick(href, event)
                }}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {normalizeDisplayMathDelimiters(displayedContent)}
      </ReactMarkdown>
    </div>
  )
})

export default StreamingMarkdown
