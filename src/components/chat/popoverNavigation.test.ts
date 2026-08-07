import {
  calculatePopoverPosition,
  getMenuNavigationIndex,
  isMenuNavigationKey,
} from './popoverNavigation'

describe('calculatePopoverPosition', () => {
  it('uses the supplied viewport for left and right alignment', () => {
    const anchor = { top: 240, left: 32, right: 172 }

    expect(
      calculatePopoverPosition(anchor, { width: 500, height: 400 }, 'left'),
    ).toEqual({
      position: 'fixed',
      bottom: '164px',
      maxHeight: 228,
      left: '32px',
    })
    expect(
      calculatePopoverPosition(anchor, { width: 900, height: 700 }, 'right'),
    ).toEqual({
      position: 'fixed',
      bottom: '464px',
      maxHeight: 228,
      right: '728px',
    })
  })

  it('never returns a negative maximum height', () => {
    expect(
      calculatePopoverPosition(
        { top: 8, left: 0, right: 20 },
        { width: 200, height: 100 },
        'left',
      ).maxHeight,
    ).toBe(0)
  })
})

describe('menu navigation', () => {
  it('wraps arrow navigation and supports Home/End', () => {
    expect(getMenuNavigationIndex('ArrowDown', 2, 3)).toBe(0)
    expect(getMenuNavigationIndex('ArrowUp', 0, 3)).toBe(2)
    expect(getMenuNavigationIndex('Home', 2, 3)).toBe(0)
    expect(getMenuNavigationIndex('End', 0, 3)).toBe(2)
  })

  it('starts at the appropriate edge and handles empty menus', () => {
    expect(getMenuNavigationIndex('ArrowDown', -1, 3)).toBe(0)
    expect(getMenuNavigationIndex('ArrowUp', -1, 3)).toBe(2)
    expect(getMenuNavigationIndex('ArrowDown', -1, 0)).toBe(-1)
  })

  it('recognizes only supported navigation keys', () => {
    expect(isMenuNavigationKey('ArrowDown')).toBe(true)
    expect(isMenuNavigationKey('Escape')).toBe(false)
  })
})
