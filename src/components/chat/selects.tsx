import type { SessionConfigOption, SessionMode } from '@agentclientprotocol/sdk'
import {
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Hammer,
  ListChecks,
  Wrench,
} from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { useLanguage } from '../../contexts/language-context'

import {
  type PopoverAlign,
  calculatePopoverPosition,
  getMenuNavigationIndex,
  isMenuNavigationKey,
} from './popoverNavigation'

type FlatOption = {
  value: string
  name: string
  description?: string
}

function flattenConfigOptions(option: SessionConfigOption): FlatOption[] {
  if (option.type !== 'select') return []
  const flat: FlatOption[] = []
  for (const item of option.options) {
    if ('options' in item) {
      for (const child of item.options) {
        flat.push({
          value: child.value,
          name: child.name,
          description: child.description ?? undefined,
        })
      }
    } else {
      flat.push({
        value: item.value,
        name: item.name,
        description: item.description ?? undefined,
      })
    }
  }
  return flat
}

const POPOVER_OPEN_EVENT = 'yolo-acp-popover-open'
const MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]'
const CHECKED_MENU_ITEM_SELECTOR =
  '[role="menuitem"][aria-checked="true"], [role="menuitemradio"][aria-checked="true"], [role="menuitemcheckbox"][aria-checked="true"]'
let popoverSeq = 0

type PopoverOpenAction = boolean | ((previous: boolean) => boolean)

function findPopoverTrigger(container: HTMLElement | null): HTMLElement | null {
  return container?.querySelector<HTMLElement>('button:not(:disabled)') ?? null
}

function getEnabledMenuItems(popover: HTMLElement): HTMLElement[] {
  return Array.from(
    popover.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
  ).filter(
    (item) =>
      !item.matches(':disabled') &&
      item.getAttribute('aria-disabled') !== 'true',
  )
}

export function usePopover() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const idRef = useRef<string>(`popover-${++popoverSeq}`)
  const openRef = useRef(false)

  const restoreTriggerFocus = useCallback(() => {
    findPopoverTrigger(containerRef.current)?.focus()
  }, [])

  const closePopover = useCallback(
    (restoreFocus: boolean) => {
      if (!openRef.current) return
      openRef.current = false
      setOpen(false)
      if (restoreFocus) restoreTriggerFocus()
    },
    [restoreTriggerFocus],
  )

  const setOpenWrapped = useCallback(
    (next: PopoverOpenAction) => {
      const previous = openRef.current
      const value = typeof next === 'function' ? next(previous) : next
      if (value === previous) return
      openRef.current = value
      setOpen(value)

      if (value) {
        const ownerWindow = containerRef.current?.ownerDocument.defaultView
        if (ownerWindow) {
          ownerWindow.dispatchEvent(
            new ownerWindow.CustomEvent(POPOVER_OPEN_EVENT, {
              detail: idRef.current,
            }),
          )
        }
      } else {
        restoreTriggerFocus()
      }
    },
    [restoreTriggerFocus],
  )

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    const ownerDocument = container?.ownerDocument
    const ownerWindow = ownerDocument?.defaultView
    if (!container || !ownerDocument || !ownerWindow) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      const targetNode = target instanceof ownerWindow.Node ? target : null
      const targetElement =
        target instanceof ownerWindow.Element ? target : null
      if (
        (!targetNode || !container.contains(targetNode)) &&
        !targetElement?.closest('.yolo-acp-select-popover')
      ) {
        closePopover(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closePopover(true)
    }
    const handleOtherOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== idRef.current) {
        closePopover(false)
      }
    }
    ownerDocument.addEventListener('mousedown', handlePointerDown)
    ownerDocument.addEventListener('keydown', handleEscape)
    ownerWindow.addEventListener(POPOVER_OPEN_EVENT, handleOtherOpen)
    return () => {
      ownerDocument.removeEventListener('mousedown', handlePointerDown)
      ownerDocument.removeEventListener('keydown', handleEscape)
      ownerWindow.removeEventListener(POPOVER_OPEN_EVENT, handleOtherOpen)
    }
  }, [closePopover, open])
  return { open, setOpen: setOpenWrapped, containerRef }
}

export function SelectPopover({
  open,
  anchorRef,
  align = 'left',
  children,
}: {
  open: boolean
  anchorRef: React.RefObject<HTMLDivElement | null>
  align?: PopoverAlign
  children: React.ReactNode
}) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  const popoverRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const ownerDocument = anchor?.ownerDocument
    const ownerWindow = ownerDocument?.defaultView
    if (!open || !anchor || !ownerDocument || !ownerWindow) return

    let animationFrame: number | null = null
    const updatePosition = () => {
      animationFrame = null
      const rect = anchor.getBoundingClientRect()
      setStyle(
        calculatePopoverPosition(
          rect,
          { width: ownerWindow.innerWidth, height: ownerWindow.innerHeight },
          align,
        ),
      )
    }
    const schedulePositionUpdate = () => {
      if (animationFrame !== null) return
      if (typeof ownerWindow.requestAnimationFrame === 'function') {
        animationFrame = ownerWindow.requestAnimationFrame(updatePosition)
      } else {
        updatePosition()
      }
    }

    updatePosition()
    ownerWindow.addEventListener('resize', schedulePositionUpdate)
    ownerWindow.addEventListener('scroll', schedulePositionUpdate)
    ownerDocument.addEventListener('scroll', schedulePositionUpdate, true)
    ownerWindow.visualViewport?.addEventListener(
      'resize',
      schedulePositionUpdate,
    )
    ownerWindow.visualViewport?.addEventListener(
      'scroll',
      schedulePositionUpdate,
    )

    const ResizeObserverConstructor = (
      ownerWindow as Window & {
        ResizeObserver?: typeof ResizeObserver
      }
    ).ResizeObserver
    const resizeObserver = ResizeObserverConstructor
      ? new ResizeObserverConstructor(schedulePositionUpdate)
      : null
    resizeObserver?.observe(anchor)

    return () => {
      if (animationFrame !== null) {
        ownerWindow.cancelAnimationFrame(animationFrame)
      }
      resizeObserver?.disconnect()
      ownerWindow.removeEventListener('resize', schedulePositionUpdate)
      ownerWindow.removeEventListener('scroll', schedulePositionUpdate)
      ownerDocument.removeEventListener('scroll', schedulePositionUpdate, true)
      ownerWindow.visualViewport?.removeEventListener(
        'resize',
        schedulePositionUpdate,
      )
      ownerWindow.visualViewport?.removeEventListener(
        'scroll',
        schedulePositionUpdate,
      )
    }
  }, [open, anchorRef, align])

  useLayoutEffect(() => {
    const popover = popoverRef.current
    if (!open || !popover) return
    if (popover.contains(popover.ownerDocument.activeElement)) return
    const initialTarget =
      popover.querySelector<HTMLElement>('input:not(:disabled)') ??
      popover.querySelector<HTMLElement>(CHECKED_MENU_ITEM_SELECTOR) ??
      getEnabledMenuItems(popover)[0]
    initialTarget?.focus()
  }, [open, anchorRef])

  const anchor = anchorRef.current
  const ownerDocument = anchor?.ownerDocument
  if (!open || !anchor || !ownerDocument?.defaultView || !ownerDocument.body) {
    return null
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="yolo-popover-surface yolo-popover-surface--default yolo-model-select-popover yolo-acp-select-popover"
      style={style}
      onKeyDown={(event) => {
        if (!isMenuNavigationKey(event.key)) return
        if (
          (event.key === 'Home' || event.key === 'End') &&
          (event.target as HTMLElement).tagName === 'INPUT'
        ) {
          return
        }
        const items = getEnabledMenuItems(event.currentTarget)
        const currentIndex = items.findIndex(
          (item) =>
            item === event.target || item.contains(event.target as Node),
        )
        const nextIndex = getMenuNavigationIndex(
          event.key,
          currentIndex,
          items.length,
        )
        if (nextIndex < 0) return
        event.preventDefault()
        items[nextIndex]?.focus()
      }}
    >
      {children}
    </div>,
    ownerDocument.body,
  )
}

export const ConfigOptionSelect = memo(function ConfigOptionSelect({
  option,
  icon,
  searchable = false,
  onChange,
}: {
  option: SessionConfigOption
  icon?: React.ReactNode
  searchable?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useLanguage()
  const { open, setOpen, containerRef } = usePopover()
  const [query, setQuery] = useState('')
  const flat = useMemo(() => flattenConfigOptions(option), [option])
  const currentValue = option.type === 'select' ? option.currentValue : ''
  const current = flat.find((item) => item.value === currentValue)

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return flat
    return flat.filter((item) => item.name.toLowerCase().includes(keyword))
  }, [flat, query])

  return (
    <div className="yolo-acp-select" ref={containerRef}>
      <button
        type="button"
        className="yolo-chat-input-model-select"
        data-state={open ? 'open' : 'closed'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        {icon}
        <div className="yolo-chat-input-model-select__label yolo-chat-input-model-select__model-name">
          {current?.name ?? option.name}
        </div>
        <div className="yolo-chat-input-model-select__icon">
          {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </div>
      </button>
      <SelectPopover open={open} anchorRef={containerRef} align="right">
        {searchable ? (
          <div className="yolo-acp-select-search">
            <input
              type="text"
              autoFocus
              placeholder={t('chat.searchModels', 'Search models…')}
              aria-label={t('chat.searchModels', 'Search models…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        ) : null}
        <div className="yolo-model-select-list" role="menu">
          {visible.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={item.value === currentValue}
              data-state={item.value === currentValue ? 'checked' : 'unchecked'}
              className="yolo-popover-item"
              onClick={() => {
                setOpen(false)
                if (item.value !== currentValue) {
                  onChange(item.value)
                }
              }}
            >
              <span className="yolo-popover-item__label">{item.name}</span>
              <span className="yolo-popover-item__indicator">
                {item.value === currentValue ? <Check size={12} /> : null}
              </span>
            </button>
          ))}
        </div>
      </SelectPopover>
    </div>
  )
})

function modeIcon(modeId: string, size = 16) {
  switch (modeId) {
    case 'plan':
      return <ListChecks size={size} />
    case 'build':
      return <Hammer size={size} />
    default:
      return <Wrench size={size} />
  }
}

export const ModeSelect = memo(function ModeSelect({
  current,
  available,
  onChange,
}: {
  current: string
  available: SessionMode[]
  onChange: (modeId: string) => void
}) {
  const { t } = useLanguage()
  const { open, setOpen, containerRef } = usePopover()
  const modes: SessionMode[] =
    available.length > 0
      ? available
      : [
          { id: 'build', name: 'build' },
          { id: 'plan', name: 'plan' },
        ]
  const active = modes.find((mode) => mode.id === current) ?? modes[0]

  const modeLabel = (mode: SessionMode) =>
    mode.id === 'plan'
      ? t('chat.modePlan', 'Plan')
      : mode.id === 'build'
        ? t('chat.modeBuild', 'Build')
        : mode.name

  return (
    <div className="yolo-acp-select" ref={containerRef}>
      <button
        type="button"
        className="yolo-chat-input-model-select yolo-chat-mode-select"
        data-state={open ? 'open' : 'closed'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        {modeIcon(active.id, 12)}
        <div className="yolo-chat-input-model-select__label">
          {modeLabel(active)}
        </div>
        <div className="yolo-chat-input-model-select__icon">
          {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </div>
      </button>
      <SelectPopover open={open} anchorRef={containerRef}>
        <div
          className="yolo-model-select-list yolo-chat-mode-select-list"
          role="menu"
        >
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="menuitemradio"
              aria-checked={mode.id === active.id}
              data-state={mode.id === active.id ? 'checked' : 'unchecked'}
              className="yolo-chat-mode-select-item"
              onClick={() => {
                setOpen(false)
                if (mode.id !== active.id) {
                  onChange(mode.id)
                }
              }}
            >
              <span className="yolo-chat-mode-select-item__icon">
                {modeIcon(mode.id)}
              </span>
              <span className="yolo-chat-mode-select-item__content">
                <span className="yolo-chat-mode-select-item__label">
                  {modeLabel(mode)}
                </span>
                {mode.description ? (
                  <span className="yolo-chat-mode-select-item__desc">
                    {mode.description}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </SelectPopover>
    </div>
  )
})

export function findConfigOption(
  configOptions: SessionConfigOption[],
  category: string,
): SessionConfigOption | null {
  return configOptions.find((option) => option.category === category) ?? null
}

export const EFFORT_ICON = <Brain size={12} />
