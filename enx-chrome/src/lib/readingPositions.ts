// Reading positions (ADR-081, amended by ADR-082 and ADR-083): one per book,
// kept only in this browser's chrome.storage.local, separately for each Clerk
// user. This module holds the rules; readingPositionWriter.ts does the I/O.

import { savedPageKey } from '@/lib/savedPagesStore'

export const STORAGE_PREFIX = 'readingPositions:'
export const storageKeyFor = (userId: string) => `${STORAGE_PREFIX}${userId}`

export const MAX_BOOKS_PER_USER = 20
export const MAX_SENTENCE_BYTES = 1024
export const ANCHOR_CONTEXT_CHARS = 32
// Across all accounts, so the feature cannot exhaust the ~10 MB every part
// of the extension shares.
export const FEATURE_BUDGET_BYTES = 4 * 1024 * 1024
export const SHARED_QUOTA_BYTES = 10 * 1024 * 1024

/** A sentence in a page's article and what it takes to find it again. */
export interface ReadingAnchor {
  /** Whitespace-normalized; the only part a user ever sees. */
  sentence: string
  /** Up to ANCHOR_CONTEXT_CHARS of article text on either side. */
  before: string
  after: string
  /** Where the sentence starts in the article text, and that text's length. */
  offset: number
  articleLength: number
  /** Normalized with savedPageKey (ADR-032). */
  sourceUrl: string
  title: string
  /** When the lookup or translation happened, epoch ms. */
  occurredAt: number
}

// Pinned sentences (#899) join the book record next to its position.
export interface BookRecord {
  position: ReadingAnchor
  /** Last open or write, epoch ms; the least recent book is evicted first. */
  touchedAt: number
}

export interface UserBooks {
  books: Record<string, BookRecord>
}

export type AnchorRejection = 'invalid-anchor' | 'sentence-too-large'

const utf8 = new TextEncoder()
export const utf8Bytes = (text: string) => utf8.encode(text).length

/** What chrome.storage counts for one item: its key and its JSON value. */
export const storedBytes = (key: string, value: unknown) =>
  utf8Bytes(key) + utf8Bytes(JSON.stringify(value))

export const normalizeWhitespace = (text: string) =>
  text.replace(/\s+/g, ' ').trim()

const isPageKey = (value: unknown): value is string =>
  typeof value === 'string' && savedPageKey(value) === value

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isContext = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= ANCHOR_CONTEXT_CHARS

const isAnchor = (value: unknown): value is ReadingAnchor => {
  const a = (value ?? {}) as Partial<ReadingAnchor>
  return (
    typeof a.sentence === 'string' &&
    a.sentence !== '' &&
    normalizeWhitespace(a.sentence) === a.sentence &&
    isContext(a.before) &&
    isContext(a.after) &&
    isCount(a.offset) &&
    isCount(a.articleLength) &&
    a.offset <= a.articleLength &&
    isPageKey(a.sourceUrl) &&
    typeof a.title === 'string' &&
    typeof a.occurredAt === 'number' &&
    Number.isFinite(a.occurredAt)
  )
}

/**
 * Checks a book key and anchor that came over a message. A sentence over the
 * byte limit is refused, never truncated.
 */
export function checkAnchor(
  bookKey: unknown,
  anchor: unknown
): { ok: true; anchor: ReadingAnchor } | { ok: false; code: AnchorRejection } {
  if (!isPageKey(bookKey) || !isAnchor(anchor)) {
    return { ok: false, code: 'invalid-anchor' }
  }
  if (utf8Bytes(anchor.sentence) > MAX_SENTENCE_BYTES) {
    return { ok: false, code: 'sentence-too-large' }
  }
  const { sentence, before, after, offset, articleLength, sourceUrl } = anchor
  const { title, occurredAt } = anchor
  return {
    ok: true,
    anchor: {
      sentence,
      before,
      after,
      offset,
      articleLength,
      sourceUrl,
      title,
      occurredAt,
    },
  }
}

export function readUserBooks(raw: unknown): UserBooks {
  const books = (raw as Partial<UserBooks> | undefined)?.books
  return { books: books && typeof books === 'object' ? { ...books } : {} }
}

/**
 * The books after an action: the newer of the stored and the new anchor wins,
 * the book becomes the most recent, and the least recent book past the cap is
 * dropped.
 */
export function withPosition(
  current: UserBooks,
  bookKey: string,
  anchor: ReadingAnchor,
  now: number
): UserBooks {
  const stored = current.books[bookKey]?.position
  const position =
    stored && stored.occurredAt > anchor.occurredAt ? stored : anchor
  const books = { ...current.books, [bookKey]: { position, touchedAt: now } }
  const byRecency = Object.keys(books).sort(
    (a, b) => books[a].touchedAt - books[b].touchedAt
  )
  for (const evicted of byRecency.slice(
    0,
    Math.max(0, byRecency.length - MAX_BOOKS_PER_USER)
  )) {
    delete books[evicted]
  }
  return { books }
}

/** The books after an open: only an existing book becomes the most recent. */
export function withOpened(
  current: UserBooks,
  bookKey: string,
  now: number
): UserBooks | null {
  const book = current.books[bookKey]
  if (!book) return null
  return { books: { ...current.books, [bookKey]: { ...book, touchedAt: now } } }
}
