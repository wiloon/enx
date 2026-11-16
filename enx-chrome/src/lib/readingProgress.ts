// L0 reading instrumentation (ADR-028 Decision 2/3): how much of an article
// the user actually read, inferred rather than measured.
//
// There is no "I finished this" button, so reading volume is a WATERMARK:
// the deepest point in the article the user has demonstrably reached, by
// either of two signals -- where they clicked a word, or how far they
// scrolled. The watermark is monotonic (clicking or scrolling back up never
// lowers it) and is converted from a character offset into a word count, so
// the number we report is in the same unit as `word_lookups`' denominator.
//
// Nothing in this module knows the URL, the title or the text of what is
// being read. It deals in two integers -- "how many words does this article
// have" and "how deep has the user got" -- because the server is only ever
// told those (ADR-028 Decision 10).

// A session is only counted as "an article read" once the watermark clears
// BOTH bars: an absolute one, so a 30-word tweet can't be an article, and a
// proportional one, so opening a longread and glancing at the first screen
// can't be either.
//
// Both numbers are guesses. They are deliberately constants with a name so
// that recalibrating them against the real distribution after launch is a
// one-line change (ADR-028 Decision 3).
export const ARTICLE_MIN_WORDS = 100
export const ARTICLE_MIN_FRACTION = 0.2

// How much the watermark must advance before we report on progress alone.
// The other flush triggers (tab hidden, idle, page unload) are time-based and
// live in the content script; this one bounds how much is at risk when a tab
// is closed in a way that fires no event at all.
export const FLUSH_EVERY_WORDS = 100

// The scroll watermark is discounted by one viewport: the screenful the user
// has only just scrolled into view has not been read yet. Without this,
// slamming End counts the whole article as read.
const SCROLL_DISCOUNT_VIEWPORTS = 1

/** One article node and where its text starts in the concatenated article. */
type NodeSpan = {
  node: Element
  /** Character offset of this node's first character within the article. */
  charBase: number
  charLength: number
}

/** What the tracker hands to the reporter when it flushes. */
export type ProgressDelta = {
  wordsRead: number
  articlesRead: number
}

/**
 * Converts a character offset into a word index by assuming words are spread
 * evenly through the text.
 *
 * This is an estimate and is meant to be: building an exact offset->word
 * table would mean keeping a parallel index of every word's position in the
 * page, invalidated by every DOM mutation, to gain precision the UI then
 * throws away by rounding (ADR-028 Decision 8 -- show "1,200", not "1,237").
 */
export function charOffsetToWords(
  charOffset: number,
  totalChars: number,
  totalWords: number
): number {
  if (totalChars <= 0 || totalWords <= 0) return 0
  const clamped = Math.max(0, Math.min(charOffset, totalChars))
  return Math.round((clamped / totalChars) * totalWords)
}

/** ADR-028 Decision 3: does this watermark count as having read an article? */
export function qualifiesAsArticle(
  watermarkWords: number,
  totalWords: number
): boolean {
  if (totalWords <= 0) return false
  return (
    watermarkWords >= ARTICLE_MIN_WORDS &&
    watermarkWords / totalWords >= ARTICLE_MIN_FRACTION
  )
}

/**
 * The read watermark for one article, in words.
 *
 * One instance per `enxRun`. Re-running on a new page replaces it, which is
 * what makes "articles read" countable at all: the old session's unreported
 * progress is flushed, and the new one starts from zero.
 */
export class ReadingSession {
  private readonly spans: NodeSpan[]
  private readonly totalChars: number
  readonly totalWords: number

  /** Deepest point reached, in words. Monotonic. */
  private watermark = 0
  /** How much of the watermark has already been sent to the server. */
  private reported = 0
  /** An article is counted once, on the flush that first qualifies it. */
  private articleCounted = false

  constructor(nodes: Element[], totalWords: number) {
    this.totalWords = Math.max(0, totalWords)

    let base = 0
    this.spans = nodes.map(node => {
      const charLength = (node.textContent || '').length
      const span = { node, charBase: base, charLength }
      base += charLength
      return span
    })
    this.totalChars = base
  }

  /** Current watermark, for tests and for the flush-on-progress check. */
  get watermarkWords(): number {
    return this.watermark
  }

  /** Words read but not yet reported. */
  get unreportedWords(): number {
    return Math.max(0, this.watermark - this.reported)
  }

  private raiseTo(words: number) {
    if (words > this.watermark) {
      this.watermark = Math.min(words, this.totalWords)
    }
  }

  /**
   * Records that the user interacted with `reference` -- a click on a word.
   * A click is the strongest signal we get: the user was looking at that
   * exact word, so everything before it has been read.
   */
  noteInteraction(reference: Range): void {
    const span = this.spans.find(s => s.node.contains(reference.startContainer))
    if (!span) return

    const range = document.createRange()
    range.selectNodeContents(span.node)
    try {
      range.setEnd(reference.startContainer, reference.startOffset)
    } catch {
      // The reference points outside the span after all (detached node, DOM
      // rebuilt under us). A lost watermark update is not worth an exception
      // on the lookup path.
      return
    }
    const offsetInNode = range.toString().length
    this.raiseTo(
      charOffsetToWords(
        span.charBase + offsetInNode,
        this.totalChars,
        this.totalWords
      )
    )
  }

  /**
   * Records how far the article has been scrolled, from the article nodes'
   * viewport geometry. Called on a throttled scroll listener.
   *
   * `viewportBottom` and each node's rect are in the same client-coordinate
   * space, so this needs no knowledge of the scroll container -- which is the
   * point: on sites that scroll an inner div rather than the document, the
   * rects still move.
   */
  noteScroll(viewportHeight: number): void {
    if (this.totalChars === 0) return

    // The line the user is credited with having read down to: one screen
    // above the bottom of the viewport.
    const readLine = viewportHeight * (1 - SCROLL_DISCOUNT_VIEWPORTS)

    let deepestChars = 0
    for (const span of this.spans) {
      const rect = span.node.getBoundingClientRect()
      if (rect.height <= 0) continue
      if (rect.top >= readLine) continue // not reached yet

      // How far into this node the read line sits, as a fraction of its box.
      const fraction = Math.min(1, (readLine - rect.top) / rect.height)
      const chars = span.charBase + fraction * span.charLength
      if (chars > deepestChars) deepestChars = chars
    }

    this.raiseTo(
      charOffsetToWords(deepestChars, this.totalChars, this.totalWords)
    )
  }

  /**
   * Takes everything not yet reported and marks it as reported.
   *
   * Handing out the delta and clearing it in one step is deliberate: the
   * caller may fail to send it, and ADR-028 Decision 5 says statistics are
   * allowed to be lossy. Re-counting a dropped report would be worse than
   * losing it, because it would inflate a number the user is told is real.
   */
  takeDelta(): ProgressDelta {
    const wordsRead = this.unreportedWords
    const nowQualifies = qualifiesAsArticle(this.watermark, this.totalWords)
    const articlesRead = !this.articleCounted && nowQualifies ? 1 : 0
    if (articlesRead) this.articleCounted = true
    this.reported = this.watermark
    return { wordsRead, articlesRead }
  }
}
