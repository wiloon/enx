import { WordData } from '@/types'

// What a highlightable "word" is and which review-stage underline it gets
// (ADR-011 Decision 1 / E1), shared by the page (WordProcessor) and the Side
// Panel's sentence original (ADR-053 Decision 2). Pure string logic, no DOM,
// so the Side Panel bundle doesn't pull in WordProcessor.

// CSS Custom Highlight API registry names, one per review stage. The
// underline colour for each stage lives here too so the count and the
// palette stay in one place -- the ::highlight() rules are generated from
// HIGHLIGHT_BUCKET_COLORS.
//
// An ordinal ramp: one hue, lightness rising monotonically, so a reader can
// tell stage order from the colour alone. The previous red/orange/yellow/
// green/blue scale could not be ordered by eye, and it spent five hues on a
// single encoding, leaving nothing of the wheel for the rest of the UI.
// Violet is deliberately none of link-blue, marker-yellow, success-green or
// error-red, so an underline never impersonates one of those.
// Literal colours, not tokens: these rules are injected into the host page's
// document, which has none of our custom properties.
export const HIGHLIGHT_NAME_PREFIX = 'enx-hl-'
export const HIGHLIGHT_BUCKET_COLORS: readonly string[] = [
  'oklch(0.45 0.13 305)', // 1 - very new, most prominent
  'oklch(0.53 0.13 305)', // 2
  'oklch(0.61 0.12 305)', // 3
  'oklch(0.69 0.1 305)', // 4
  'oklch(0.77 0.08 305)', // 5 - nearly known, faintest
]
export const REVIEW_BUCKET_COUNT = HIGHLIGHT_BUCKET_COLORS.length

// The ::highlight() rules painting each review stage's underline.
export const reviewBucketHighlightCss = (): string =>
  HIGHLIGHT_BUCKET_COLORS.map(
    (color, i) =>
      `::highlight(${HIGHLIGHT_NAME_PREFIX}${i + 1}) {` +
      ` text-decoration-line: underline;` +
      ` text-decoration-color: ${color};` +
      ` text-decoration-thickness: 1px; }`
  ).join('\n')

// Whether a word is still worth reviewing (and so worth highlighting).
// False for words the user has marked known, words tagged as a known
// part of speech, and words never actually looked up (LoadCount 0).
export const isReviewable = (wordData: WordData): boolean =>
  !wordData.Known && wordData.WordType !== 1 && wordData.LoadCount !== 0

// Which review-stage bucket a word belongs to (1 = most recently learned,
// REVIEW_BUCKET_COUNT = nearly known), or null when it shouldn't be
// highlighted at all. Replaces the ~31-step continuous hue with a handful
// of stages (ADR-011 E1); the "don't highlight" sentinel disappears
// because those words simply produce no Range. Boundaries are a first
// pass, tuned later against real articles -- keep the count of branches
// equal to REVIEW_BUCKET_COUNT.
export const reviewBucket = (wordData: WordData): number | null => {
  if (!isReviewable(wordData)) return null

  const count = wordData.LoadCount
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 10) return 3
  if (count <= 18) return 4
  return REVIEW_BUCKET_COUNT
}

export interface WordToken {
  word: string
  start: number
  end: number
}

// One shared word segmenter -- construction isn't free and tokenizeWords
// runs once per text node.
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' })

const ALPHA_SEGMENT = /^[A-Za-z]+$/

// Splits `text` into word tokens with their offsets, aligned with the keys
// WordProcessor.extractWords() produces (which is what wordDict is keyed
// by). ICU word segmentation is the base; two adjustments make the tokens
// line up:
//   - drop segments with no ASCII letter (numbers, symbols) -- extractWords
//     rejects them too;
//   - rejoin `-<word>` runs so "well-known" / "state-of-the-art" stay whole
//     (ICU splits on the hyphen), but ONLY across letter-only segments, so
//     "COVID-19" / "Catch-22" tokenize to "covid" / "catch" -- which is
//     exactly what extractWords' letter-bounded pattern yields.
export const tokenizeWords = (text: string): WordToken[] => {
  if (!text) return []
  const segments = [...wordSegmenter.segment(text)]
  const tokens: WordToken[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg.isWordLike || !/[a-zA-Z]/.test(seg.segment)) continue

    let end = seg.index + seg.segment.length
    while (
      segments[i + 1]?.segment === '-' &&
      segments[i + 1].index === end &&
      segments[i + 2]?.index === end + 1 &&
      ALPHA_SEGMENT.test(segments[i + 2].segment)
    ) {
      end = segments[i + 2].index + segments[i + 2].segment.length
      i += 2
    }

    tokens.push({ word: text.slice(seg.index, end), start: seg.index, end })
  }
  return tokens
}

export interface CharSpan {
  start: number
  end: number
}

export interface SentenceHighlightSpans {
  // Every occurrence of the anchor word (ADR-053 Decision 1).
  anchor: CharSpan[]
  // Review-stage underlines, keyed by bucket.
  buckets: Map<number, CharSpan[]>
}

// The character spans to mark in a Side Panel sentence original (ADR-053):
// the anchor word the panel was opened for, and the review-stage underline
// of every word in `wordStates` (keyed by lower-cased word, like the page's
// wordCache). `underlinesOn` is the "highlight vocabulary while reading"
// preference; it never hides the anchor.
export const sentenceHighlightSpans = (
  sentence: string,
  anchorWord: string,
  wordStates: Record<string, WordData>,
  underlinesOn: boolean
): SentenceHighlightSpans => {
  const anchor: CharSpan[] = []
  const buckets = new Map<number, CharSpan[]>()
  const anchorKey = anchorWord.toLowerCase()

  for (const { word, start, end } of tokenizeWords(sentence)) {
    const key = word.toLowerCase()
    if (anchorKey && key === anchorKey) anchor.push({ start, end })

    const data = underlinesOn ? wordStates[key] : undefined
    const bucket = data ? reviewBucket(data) : null
    if (bucket === null) continue
    const spans = buckets.get(bucket)
    if (spans) spans.push({ start, end })
    else buckets.set(bucket, [{ start, end }])
  }
  return { anchor, buckets }
}

// The page wordCache entries for the words in `sentence` (keyed by
// lower-cased word), handed to the Side Panel with the sentence so its
// original starts out underlined like the page (ADR-053 Decision 3).
export const sentenceWordStates = (
  sentence: string,
  wordCache: Record<string, WordData>
): Record<string, WordData> => {
  const states: Record<string, WordData> = {}
  for (const { word } of tokenizeWords(sentence)) {
    const key = word.toLowerCase()
    if (wordCache[key]) states[key] = wordCache[key]
  }
  return states
}
