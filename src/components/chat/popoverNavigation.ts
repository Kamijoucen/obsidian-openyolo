export type PopoverAlign = 'left' | 'right'

type PopoverAnchorRect = {
  top: number
  left: number
  right: number
}

type PopoverViewport = {
  width: number
  height: number
}

type PopoverPosition = {
  position: 'fixed'
  bottom: string
  maxHeight: number
  left?: string
  right?: string
}

export function calculatePopoverPosition(
  anchor: PopoverAnchorRect,
  viewport: PopoverViewport,
  align: PopoverAlign,
): PopoverPosition {
  const position: PopoverPosition = {
    position: 'fixed',
    bottom: `${viewport.height - anchor.top + 4}px`,
    maxHeight: Math.max(0, Math.min(300, anchor.top - 12)),
  }
  if (align === 'right') {
    position.right = `${viewport.width - anchor.right}px`
  } else {
    position.left = `${anchor.left}px`
  }
  return position
}

type MenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

export function isMenuNavigationKey(key: string): key is MenuNavigationKey {
  return (
    key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End'
  )
}

export function getMenuNavigationIndex(
  key: MenuNavigationKey,
  currentIndex: number,
  itemCount: number,
): number {
  if (itemCount <= 0) return -1
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  if (key === 'ArrowDown') {
    return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount
  }
  return currentIndex < 0
    ? itemCount - 1
    : (currentIndex - 1 + itemCount) % itemCount
}
