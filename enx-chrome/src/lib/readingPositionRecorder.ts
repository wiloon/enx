// The tab's half of reading positions (ADR-081 Decision 2, ADR-082): each
// lookup or translation becomes an anchor validated against the article and
// goes to the background writer at once; the writer debounces. A tab going
// hidden or away asks it to write now.

import { readArticleText } from '@/lib/articleText'
import { buildReadingAnchor, readingBook } from '@/lib/readingAnchor'
import type { ReadingAnchor } from '@/lib/readingPositions'
import type { SiteAdapter } from '@/lib/siteAdapters'

export type ReadingPositionMessage =
  | { type: 'recordReadingPosition'; bookKey: string; anchor: ReadingAnchor }
  | { type: 'flushReadingPositions' }

export interface ReadingPositionRecorderDeps {
  send: (message: ReadingPositionMessage) => void
  now: () => number
  page: () => {
    href: string
    title: string
    adapter: Pick<SiteAdapter, 'bookKey'>
  }
}

export function createReadingPositionRecorder(
  deps: ReadingPositionRecorderDeps
) {
  let article: readonly Element[] = []
  let unflushed = false

  return {
    /** The lookup area anchors are measured in; empty records nothing. */
    setArticle(roots: readonly Element[]) {
      article = roots
    },

    /**
     * Records the text `sentence` spans as the book's position. Returns
     * false, sending nothing, when it can't be located in the article.
     */
    record(sentence: Range): boolean {
      const occurredAt = deps.now()
      if (article.length === 0) return false
      const { href, title, adapter } = deps.page()
      const book = readingBook(adapter, href)
      if (!book) return false
      const text = readArticleText(article)
      const anchor = buildReadingAnchor(
        text.text,
        text.offsetOf(sentence.startContainer, sentence.startOffset),
        sentence.toString(),
        { sourceUrl: book.sourceUrl, title },
        occurredAt
      )
      if (!anchor) return false
      deps.send({
        type: 'recordReadingPosition',
        bookKey: book.bookKey,
        anchor,
      })
      unflushed = true
      return true
    },

    /** Asks the writer to write what this tab sent; best effort. */
    flush() {
      if (!unflushed) return
      unflushed = false
      deps.send({ type: 'flushReadingPositions' })
    },
  }
}
