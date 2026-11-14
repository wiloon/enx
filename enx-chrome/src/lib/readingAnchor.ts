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
