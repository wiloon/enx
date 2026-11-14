// The tab's half of reading positions (ADR-081 Decision 2, ADR-082): each
// lookup or translation becomes an anchor validated against the article and
// goes to the background writer at once; the writer debounces. A tab going
// hidden or away asks it to write now.

import { readArticleText } from '@/lib/articleText'
import { buildReadingAnchor, readingBook } from '@/lib/readingAnchor'
import type { NotSavedCode } from '@/lib/readingPositionResume'
import type { ReadingAnchor } from '@/lib/readingPositions'
import type { SiteAdapter } from '@/lib/siteAdapters'

export type ReadingPositionMessage =
  | { type: 'recordReadingPosition'; bookKey: string; anchor: ReadingAnchor }
  | { type: 'flushReadingPositions' }

export interface ReadingPositionRecorderDeps {
  /** Resolves with the writer's reply, once the write is done. */
  send: (message: ReadingPositionMessage) => Promise<unknown>
  now: () => number
  page: () => {
    href: string
    title: string
    adapter: Pick<SiteAdapter, 'bookKey'>
  }
  /** A sentence on this page went to the writer. */
  onRecorded?: () => void
  /** The writer could not store it; the previous position stands. */
  onNotSaved?: (code: NotSavedCode) => void
}

const notSavedCode = (reply: unknown): NotSavedCode | null => {
  const code = (reply as { ok?: boolean; code?: unknown } | null)?.code
  return code === 'storage-full' || code === 'write-failed' ? code : null
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
      void deps
        .send({ type: 'recordReadingPosition', bookKey: book.bookKey, anchor })
        .then(reply => {
          const code = notSavedCode(reply)
          if (code) deps.onNotSaved?.(code)
        })
      unflushed = true
      deps.onRecorded?.()
      return true
    },

    /** The book this page belongs to, or null for an address with none. */
    bookKey(): string | null {
      const { href, adapter } = deps.page()
      return readingBook(adapter, href)?.bookKey ?? null
    },

    /** Asks the writer to write what this tab sent; best effort. */
    flush() {
      if (!unflushed) return
      unflushed = false
      void deps.send({ type: 'flushReadingPositions' })
    },
  }
}
