// Building a reading anchor (ADR-081 Decision 1, ADR-082): pure text in,
// anchor out. The DOM side, turning a Range into an article offset, is
// articleText.ts.

import {
  ANCHOR_CONTEXT_CHARS,
  normalizeWhitespace,
  type ReadingAnchor,
} from '@/lib/readingPositions'
import { savedPageKey } from '@/lib/savedPagesStore'
import type { SiteAdapter } from '@/lib/siteAdapters'

/**
 * The anchor for `sentence` starting at `offset` in the article text, or null
 * when it is not there: a sentence that can't be located now is never
 * recorded, so it can't replace a position that could be.
 */
export function buildReadingAnchor(
  articleText: string,
  offset: number | null,
  sentence: string,
  page: { sourceUrl: string; title: string },
  occurredAt: number
): ReadingAnchor | null {
  const normalized = normalizeWhitespace(sentence)
  if (normalized === '' || offset === null) return null
  if (!articleText.startsWith(normalized, offset)) return null
  const end = offset + normalized.length
  return {
    sentence: normalized,
    before: articleText.slice(
      Math.max(0, offset - ANCHOR_CONTEXT_CHARS),
      offset
    ),
    after: articleText.slice(end, end + ANCHOR_CONTEXT_CHARS),
    offset,
    articleLength: articleText.length,
    sourceUrl: page.sourceUrl,
    title: page.title,
    occurredAt,
  }
}

export type FoundAnchor =
  | { found: true; offset: number }
  /** Not in the text: `offset` is as far through it as the anchor was. */
  | { found: false; offset: number }

const commonSuffix = (a: string, b: string) => {
  let n = 0
  while (
    n < a.length &&
    n < b.length &&
    a[a.length - 1 - n] === b[b.length - 1 - n]
  )
    n++
  return n
}

const commonPrefix = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/**
 * Where the anchor's sentence starts in the article text now. Of several
 * occurrences the one whose context matches more wins, then the one nearest
 * the recorded offset. Never a neighbouring sentence: an absent one is
 * reported as not found.
 */
export function findReadingAnchor(
  articleText: string,
  anchor: Pick<
    ReadingAnchor,
    'sentence' | 'before' | 'after' | 'offset' | 'articleLength'
  >
): FoundAnchor {
  const { sentence, before, after } = anchor
  let best: { offset: number; context: number; distance: number } | null = null
  for (
    let at = articleText.indexOf(sentence);
    at >= 0 && sentence !== '';
    at = articleText.indexOf(sentence, at + 1)
  ) {
    const end = at + sentence.length
    const context =
      commonSuffix(
        articleText.slice(Math.max(0, at - before.length), at),
        before
      ) + commonPrefix(articleText.slice(end, end + after.length), after)
    const distance = Math.abs(at - anchor.offset)
    if (
      !best ||
      context > best.context ||
      (context === best.context && distance < best.distance)
    ) {
      best = { offset: at, context, distance }
    }
  }
  if (best) return { found: true, offset: best.offset }
  const fraction =
    anchor.articleLength > 0 ? anchor.offset / anchor.articleLength : 0
  return { found: false, offset: Math.round(fraction * articleText.length) }
}

/**
 * The book a page belongs to and its normalized address (ADR-032). The
 * adapter's book key wins over the page address; null when either is an
 * address savedPageKey rejects.
 */
export function readingBook(
  adapter: Pick<SiteAdapter, 'bookKey'>,
  href: string
): { bookKey: string; sourceUrl: string } | null {
  const sourceUrl = savedPageKey(href)
  if (!sourceUrl) return null
  const bookKey = adapter.bookKey
    ? savedPageKey(adapter.bookKey(href))
    : sourceUrl
  return bookKey ? { bookKey, sourceUrl } : null
}
