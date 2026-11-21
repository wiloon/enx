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

// Page tone for the host-page highlight palette (ADR-086). Light = today's
// colours; dark = a lighter violet ramp and dimmer warm washes.
export type PageTone = 'light' | 'dark'

const DARK_UNDERLINE_COLORS: readonly string[] = [
  'oklch(0.90 0.10 305)', // 1 - very new, most prominent on dark pages
  'oklch(0.82 0.11 305)', // 2
  'oklch(0.74 0.12 305)', // 3
  'oklch(0.66 0.12 305)', // 4
  'oklch(0.58 0.12 305)', // 5 - nearly known, faintest
]

// ADR-025 / ADR-085 washes: warm accent for temporary location on the host
// page (ADR-054). Tone-dependent so dark pages keep underlines and body text
// readable (ADR-086).
const WASH_COLORS: Record<
  PageTone,
  {
    activeSentenceWash: string
    clickedWordWash: string
    hoverSentenceWash: string
  }
> = {
  light: {
    // ADR-025, the sentence a word click opened the panel for. The one warm
    // accent in the system, and intentionally so: it is a transient locator on
    // someone else's page, where a warm wash stays legible against backgrounds
    // that the cool tokens have to compete with.
    activeSentenceWash: 'hsl(45 95% 55% / 35%)',
    // ADR-085, the clicked word inside that sentence: the same warm hue, more
    // opaque, painted over the sentence wash.
    clickedWordWash: 'hsl(45 95% 55% / 60%)',
    // ADR-068 / ADR-054: preview wash for the hover translate button's sentence.
    // Lower opacity than the active-sentence wash.
    hoverSentenceWash: 'hsl(45 95% 55% / 20%)',
  },
  dark: {
    activeSentenceWash: 'hsl(45 95% 45% / 20%)',
    clickedWordWash: 'hsl(45 95% 45% / 35%)',
    hoverSentenceWash: 'hsl(45 95% 45% / 12%)',
  },
}

export const underlineColorsForTone = (
  tone: PageTone
): readonly string[] =>
  tone === 'dark' ? DARK_UNDERLINE_COLORS : HIGHLIGHT_BUCKET_COLORS

export const washColorsForTone = (
  tone: PageTone
): {
  activeSentenceWash: string
  clickedWordWash: string
  hoverSentenceWash: string
} => WASH_COLORS[tone]

// Hover sentence wash (ADR-068). Outside enx-hl-* so review paints never clear it.
export const HOVER_SENTENCE_HIGHLIGHT_NAME = 'enx-hover-sentence'

// Relative luminance of a channel in 0..1 after sRGB linearisation (WCAG 2).
const linearizeSrgb = (channel: number): number => {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const relativeLuminance = (r: number, g: number, b: number): number =>
  0.2126 * linearizeSrgb(r) +
  0.7152 * linearizeSrgb(g) +
  0.0722 * linearizeSrgb(b)

// Parse Chrome's computed `color`: rgb()/rgba(), comma- or space-separated,
// optional `/ a` alpha. Returns null when the string is not one of those
// (oklch, lab, color(), empty, garbage) or when alpha is 0.
const parseComputedRgb = (
  color: string
): { r: number; g: number; b: number } | null => {
  const s = color.trim()
  if (!s) return null

  // rgb(r, g, b) / rgba(r, g, b, a) with commas
  const comma = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+%?))?\s*\)$/i.exec(
    s
  )
  if (comma) {
    const alpha = parseAlpha(comma[4])
    if (alpha === 0) return null
    return {
      r: Number(comma[1]),
      g: Number(comma[2]),
      b: Number(comma[3]),
    }
  }

  // Modern: rgb(r g b / a) or rgb(r g b)
  const space =
    /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(
      s
    )
  if (space) {
    const alpha = parseAlpha(space[4])
    if (alpha === 0) return null
    return {
      r: Number(space[1]),
      g: Number(space[2]),
      b: Number(space[3]),
    }
  }

  return null
}

// Missing alpha means opaque (1). "50%" → 0.5. Never throws.
const parseAlpha = (raw: string | undefined): number => {
  if (raw === undefined) return 1
  if (raw.endsWith('%')) return Number(raw.slice(0, -1)) / 100
  return Number(raw)
}

// Decide light vs dark page tone from a computed CSS colour string (ADR-086
// Decision 2). Relative luminance strictly > 0.18 → dark (light text); at
// or below 0.18 → light. Unparseable / alpha 0 → light. Never throws.
export const pageToneFromComputedColor = (color: string): PageTone => {
  try {
    const rgb = parseComputedRgb(color)
    if (!rgb) return 'light'
    return relativeLuminance(rgb.r, rgb.g, rgb.b) > 0.18 ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// The ::highlight() rules painting each review stage's underline.
// No tone argument keeps the light set so the Side Panel stays on light
// (ADR-086 Decision 6).
export const reviewBucketHighlightCss = (tone: PageTone = 'light'): string =>
  underlineColorsForTone(tone)
    .map(
      (color, i) =>
        `::highlight(${HIGHLIGHT_NAME_PREFIX}${i + 1}) {` +
        ` text-decoration-line: underline;` +
        ` text-decoration-color: ${color};` +
        ` text-decoration-thickness: 1px; }`
    )
    .join('\n')

// Full host-page highlight CSS for a tone: review buckets + active-sentence
// + clicked-word washes (ADR-086). Highlight names do not change with tone.
export const hostPageHighlightCss = (tone: PageTone): string => {
  const washes = washColorsForTone(tone)
  return (
    reviewBucketHighlightCss(tone) +
    `\n::highlight(enx-active-sentence) {` +
    ` background-color: ${washes.activeSentenceWash}; }` +
    `\n::highlight(enx-clicked-word) {` +
    ` background-color: ${washes.clickedWordWash}; }` +
    `\n::highlight(${HOVER_SENTENCE_HIGHLIGHT_NAME}) {` +
    ` background-color: ${washes.hoverSentenceWash}; }`
  )
}

// The key a word's state is stored and looked up under, everywhere: the
// review list, the page's word cache, page and Side Panel underlines
// (ADR-069). Lower case, straight apostrophes, and no possessive 's, the way
// enx-api's SetEnglishField reads a page token: "Cat’s" is "cat".
export const wordKey = (word: string): string =>
  word.toLowerCase().replace(/’/g, "'").replace(/'s/g, '')

// Whether a word is still worth reviewing (and so worth highlighting).
// False for words the user has marked known, words tagged as a known
// part of speech, and words never actually looked up (LoadCount 0).
export const isReviewable = (wordData: WordData): boolean =>
  !wordData.Known && wordData.WordType !== 1 && (wordData.LoadCount ?? 0) > 0

// Which review-stage bucket a word belongs to (1 = most recently learned,
// REVIEW_BUCKET_COUNT = nearly known), or null when it shouldn't be
// highlighted at all. Replaces the ~31-step continuous hue with a handful
// of stages (ADR-011 E1); the "don't highlight" sentinel disappears
// because those words simply produce no Range. Boundaries are a first
// pass, tuned later against real articles -- keep the count of branches
// equal to REVIEW_BUCKET_COUNT.
export const reviewBucket = (wordData: WordData): number | null => {
  if (!isReviewable(wordData)) return null

  const count = wordData.LoadCount ?? 0
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
// of every word in `wordStates` (keyed by wordKey, like the page's
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
    if (anchorKey && word.toLowerCase() === anchorKey) {
      anchor.push({ start, end })
    }

    const data = underlinesOn ? wordStates[wordKey(word)] : undefined
    const bucket = data ? reviewBucket(data) : null
    if (bucket === null) continue
    const spans = buckets.get(bucket)
    if (spans) spans.push({ start, end })
    else buckets.set(bucket, [{ start, end }])
  }
  return { anchor, buckets }
}

// The page wordCache entries for the words in `sentence` (keyed by
// wordKey), handed to the Side Panel with the sentence so its original
// starts out underlined like the page (ADR-053 Decision 3).
export const sentenceWordStates = (
  sentence: string,
  wordCache: Record<string, WordData>
): Record<string, WordData> => {
  const states: Record<string, WordData> = {}
  for (const { word } of tokenizeWords(sentence)) {
    const key = wordKey(word)
    if (wordCache[key]) states[key] = wordCache[key]
  }
  return states
}
