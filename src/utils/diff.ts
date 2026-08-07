import {
  AdvancedLinesDiffComputer,
  ILinesDiffComputerOptions,
  LineRangeMapping,
} from 'vscode-diff'

export type InlineDiffToken = {
  type: 'same' | 'add' | 'del'
  text: string
}

export type InlineDiffLine = {
  type: 'unchanged' | 'modified' | 'added' | 'removed'
  tokens: InlineDiffToken[]
}

export const DIFF_MAX_INPUT_CHARS = 200_000
export const DIFF_MAX_INPUT_LINES = 4_000
const DIFF_MAX_COMPUTATION_TIME_MS = 100

type BoundedInlineDiff = {
  lines: InlineDiffLine[]
  inputTruncated: boolean
}

type BoundedLines = {
  lines: string[]
  truncated: boolean
}

export function splitBoundedDiffText(
  text: string,
  maxChars = DIFF_MAX_INPUT_CHARS,
  maxLines = DIFF_MAX_INPUT_LINES,
): BoundedLines {
  const charLimited = text.slice(0, maxChars)
  const allLines = charLimited.split('\n')
  const lineLimited = allLines.slice(0, maxLines)
  return {
    lines: lineLimited,
    truncated: text.length > maxChars || allLines.length > maxLines,
  }
}

export function createBoundedInlineDiff(
  originalText: string,
  modifiedText: string,
): BoundedInlineDiff {
  const original = splitBoundedDiffText(originalText)
  const modified = splitBoundedDiffText(modifiedText)
  return {
    lines: createInlineDiffLines(original.lines, modified.lines),
    inputTruncated: original.truncated || modified.truncated,
  }
}

export function createInlineDiffLines(
  originalLines: string[],
  modifiedLines: string[],
): InlineDiffLine[] {
  if (originalLines.length === 0 && modifiedLines.length === 0) {
    return []
  }

  if (originalLines.length === 0) {
    return modifiedLines.map((line) => ({
      type: 'added',
      tokens: [{ type: 'add', text: line }],
    }))
  }

  if (modifiedLines.length === 0) {
    return originalLines.map((line) => ({
      type: 'removed',
      tokens: [{ type: 'del', text: line }],
    }))
  }

  const advOptions: ILinesDiffComputerOptions = {
    ignoreTrimWhitespace: false,
    computeMoves: false,
    maxComputationTimeMs: DIFF_MAX_COMPUTATION_TIME_MS,
  }
  const advDiffComputer = new AdvancedLinesDiffComputer()
  const advLineChanges = advDiffComputer.computeDiff(
    originalLines,
    modifiedLines,
    advOptions,
  ).changes

  const inlineLines: InlineDiffLine[] = []
  let lastOriginalEndLineNumberExclusive = 1

  advLineChanges.forEach((change: LineRangeMapping) => {
    const oStart = change.originalRange.startLineNumber
    const oEnd = change.originalRange.endLineNumberExclusive
    const mStart = change.modifiedRange.startLineNumber
    const mEnd = change.modifiedRange.endLineNumberExclusive

    if (oStart > lastOriginalEndLineNumberExclusive) {
      const unchanged = originalLines.slice(
        lastOriginalEndLineNumberExclusive - 1,
        oStart - 1,
      )
      unchanged.forEach((line) => {
        inlineLines.push({
          type: 'unchanged',
          tokens: [{ type: 'same', text: line }],
        })
      })
    }

    const removed = originalLines.slice(oStart - 1, oEnd - 1)
    const added = modifiedLines.slice(mStart - 1, mEnd - 1)

    removed.forEach((line) => {
      inlineLines.push({
        type: 'removed',
        tokens: [{ type: 'del', text: line }],
      })
    })
    added.forEach((line) => {
      inlineLines.push({
        type: 'added',
        tokens: [{ type: 'add', text: line }],
      })
    })

    lastOriginalEndLineNumberExclusive = oEnd
  })

  const remaining = originalLines.slice(lastOriginalEndLineNumberExclusive - 1)
  remaining.forEach((line) => {
    inlineLines.push({
      type: 'unchanged',
      tokens: [{ type: 'same', text: line }],
    })
  })

  return inlineLines
}
