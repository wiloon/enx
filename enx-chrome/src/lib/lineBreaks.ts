// Which source newlines are real line breaks for sentence segmentation
// (#1137, ADR-010 Decision 5). No DOM access: callers pass in the computed
// style and the text.

const PRESERVING_VALUES = new Set([
  'pre',
  'pre-wrap',
  'pre-line',
  'break-spaces',
  'preserve',
  'preserve-breaks',
])

// Whether a newline renders as a line break under this computed style.
export const preservesNewlines = (style: {
  whiteSpaceCollapse?: string
  whiteSpace?: string
}): boolean => {
  // `white-space-collapse` is the longhand that decides it, where supported.
  const value = style.whiteSpaceCollapse || style.whiteSpace || ''
  return value.split(/\s+/).some(token => PRESERVING_VALUES.has(token))
}

const HORIZONTAL = /[ \t]/
const CLOSERS = /["')\]}”’»›]/
const SENTENCE_END = /[.!?]/
const LINE_BREAK = /[\r\n]/
// A numbered list marker without its surrounding whitespace, shared with
// sentence segmentation.
export const NUMBERED_MARKER = String.raw`\d+[.)]`
const LIST_ITEM = new RegExp(
  String.raw`[ \t]*(?:[-*•]|${NUMBERED_MARKER})[ \t]`,
  'y'
)
const BLANK_REST_OF_LINE = /[ \t]*(?:[\r\n]|$)/y

const matchesAt = (pattern: RegExp, text: string, index: number): boolean => {
  pattern.lastIndex = index
  return pattern.test(text)
}

const skipBackwards = (text: string, index: number, skip: RegExp): number => {
  let i = index
  while (i >= 0 && skip.test(text[i])) i--
  return i
}

// Whether the line break starting at `offset` (`\n`, `\r` or a `\r\n` pair)
// ends a sentence, starts a list item, or is part of a blank line. Every other
// break is a hard wrap inside a sentence.
export const keepsLineBreak = (text: string, offset: number): boolean => {
  const next = offset + (text.startsWith('\r\n', offset) ? 2 : 1)
  const lastVisible = skipBackwards(text, offset - 1, HORIZONTAL)

  const previousLineBlank = lastVisible < 0 || LINE_BREAK.test(text[lastVisible])
  const beforeClosers = skipBackwards(text, lastVisible, CLOSERS)
  const endsSentence =
    beforeClosers >= 0 && SENTENCE_END.test(text[beforeClosers])

  return (
    endsSentence ||
    previousLineBlank ||
    matchesAt(LIST_ITEM, text, next) ||
    matchesAt(BLANK_REST_OF_LINE, text, next)
  )
}
