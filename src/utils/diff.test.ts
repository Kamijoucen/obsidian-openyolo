import {
  DIFF_MAX_INPUT_CHARS,
  DIFF_MAX_INPUT_LINES,
  createBoundedInlineDiff,
  splitBoundedDiffText,
} from './diff'

describe('bounded diff inputs', () => {
  it('truncates characters before splitting into lines', () => {
    const bounded = splitBoundedDiffText('a'.repeat(DIFF_MAX_INPUT_CHARS + 10))

    expect(bounded.truncated).toBe(true)
    expect(bounded.lines).toEqual(['a'.repeat(DIFF_MAX_INPUT_CHARS)])
  })

  it('limits line count before computing a diff', () => {
    const text = Array.from(
      { length: DIFF_MAX_INPUT_LINES + 10 },
      (_, index) => `line ${index}`,
    ).join('\n')

    const result = createBoundedInlineDiff(text, text)

    expect(result.inputTruncated).toBe(true)
    expect(result.lines.length).toBeLessThanOrEqual(DIFF_MAX_INPUT_LINES)
  })
})
