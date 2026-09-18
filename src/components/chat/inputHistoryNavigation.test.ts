import {
  InputHistoryNavigation,
  historyDirectionForKey,
} from './inputHistoryNavigation'

describe('InputHistoryNavigation', () => {
  const entries = ['first', 'second', 'third']

  it('walks backwards and forwards, then clears the input after the newest entry', () => {
    const navigation = new InputHistoryNavigation()
    expect(navigation.navigate(entries, 'next')).toBeNull()
    expect(navigation.navigate(entries, 'previous')).toBe('third')
    expect(navigation.navigate(entries, 'previous')).toBe('second')
    expect(navigation.navigate(entries, 'previous')).toBe('first')
    expect(navigation.navigate(entries, 'previous')).toBeNull()
    expect(navigation.navigate(entries, 'next')).toBe('second')
    expect(navigation.navigate(entries, 'next')).toBe('third')
    expect(navigation.navigate(entries, 'next')).toBe('')
    expect(navigation.navigate(entries, 'next')).toBeNull()
  })

  it('starts from the newest entry after an edit resets the cursor', () => {
    const navigation = new InputHistoryNavigation()
    navigation.navigate(entries, 'previous')
    navigation.navigate(entries, 'previous')
    navigation.reset()

    expect(navigation.navigate(entries, 'next')).toBeNull()
    expect(navigation.navigate(entries, 'previous')).toBe('third')
    expect(navigation.navigate(entries, 'previous')).toBe('second')
  })

  it('handles empty histories and repeated text without wrapping', () => {
    const navigation = new InputHistoryNavigation()
    expect(navigation.navigate([], 'previous')).toBeNull()
    expect(navigation.navigate([], 'next')).toBeNull()
    expect(navigation.navigate(['same', 'same'], 'previous')).toBe('same')
    expect(navigation.navigate(['same', 'same'], 'previous')).toBe('same')
    expect(navigation.navigate(['same', 'same'], 'previous')).toBeNull()
  })
})

describe('historyDirectionForKey', () => {
  const event = {
    key: 'ArrowUp',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    selectionStart: 0,
    selectionEnd: 0,
    textLength: 12,
  }

  it('only recalls at the start/end, leaving multiline cursor movement intact', () => {
    expect(historyDirectionForKey(event)).toBe('previous')
    expect(
      historyDirectionForKey({ ...event, selectionStart: 5, selectionEnd: 5 }),
    ).toBeNull()
    expect(historyDirectionForKey({ ...event, key: 'ArrowDown' })).toBeNull()
    expect(
      historyDirectionForKey({
        ...event,
        key: 'ArrowDown',
        selectionStart: 12,
        selectionEnd: 12,
      }),
    ).toBe('next')
    expect(
      historyDirectionForKey({ ...event, key: 'ArrowUp', textLength: 0 }),
    ).toBe('previous')
    expect(
      historyDirectionForKey({ ...event, key: 'ArrowDown', textLength: 0 }),
    ).toBe('next')
  })

  it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey'])(
    'does not intercept modified arrow keys: %s',
    (modifier) => {
      expect(historyDirectionForKey({ ...event, [modifier]: true })).toBeNull()
    },
  )

  it('does not replace selected text or handle other keys', () => {
    expect(historyDirectionForKey({ ...event, selectionEnd: 3 })).toBeNull()
    expect(historyDirectionForKey({ ...event, key: 'ArrowLeft' })).toBeNull()
  })
})
