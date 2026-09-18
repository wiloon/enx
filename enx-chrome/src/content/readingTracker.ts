// When to measure and when to report (ADR-028 Decision 2/5), sitting between
// the watermark itself (lib/readingProgress.ts, which is pure arithmetic over
// a DOM) and the queue that talks to the server (background/statsReporter).
//
// It exists as its own module because "reading" is a lifecycle -- start,
// deepen, flush, end -- and threading four listeners plus a timer through
// content.tsx's already long processArticleContent would bury it.

import { FLUSH_EVERY_WORDS, ReadingSession } from '@/lib/readingProgress'

/** How long a tab sits untouched before its progress is reported anyway. */
export const IDLE_FLUSH_MS = 5 * 60 * 1000

/**
 * Scroll events fire far faster than the watermark can meaningfully change,
 * and each one costs a getBoundingClientRect() per article node.
 */
const SCROLL_THROTTLE_MS = 500

type Send = (delta: { wordsRead: number; articlesRead: number }) => void

let session: ReadingSession | null = null
let send: Send | null = null
let scrollTimer: number | null = null
let idleTimer: number | null = null
let listening = false

function flush(): void {
  if (!session || !send) return
  const delta = session.takeDelta()
  if (delta.wordsRead <= 0 && delta.articlesRead <= 0) return
  send(delta)
}

function armIdleTimer(): void {
  if (idleTimer !== null) window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(flush, IDLE_FLUSH_MS)
}

/** Report as soon as enough has accumulated to be worth a round trip. */
function flushIfProgressed(): void {
  armIdleTimer()
  if (session && session.unreportedWords >= FLUSH_EVERY_WORDS) flush()
}

function onScroll(): void {
  if (scrollTimer !== null) return
  scrollTimer = window.setTimeout(() => {
    scrollTimer = null
    if (!session) return
    session.noteScroll(window.innerHeight)
    flushIfProgressed()
  }, SCROLL_THROTTLE_MS)
}

// A tab going hidden is the closest thing to "the user stopped reading" that
// the platform reliably gives us -- `beforeunload` does not fire for a
// discarded or bfcache'd tab, and `unload` is worse. Both are wired anyway;
// a duplicate flush costs nothing, because the second one finds no unreported
// words.
function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') flush()
}

function addListeners(): void {
  if (listening) return
  listening = true
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', flush)
}

/**
 * Begins tracking a new article, reporting whatever the previous one had
 * left over.
 *
 * Called from `enxRun`'s success path, where the word count has just been
 * computed for chunking and would otherwise be discarded.
 */
export function startArticle(
  nodes: Element[],
  totalWords: number,
  sender: Send
): void {
  flush() // the article being replaced
  send = sender
  session = new ReadingSession(nodes, totalWords)
  addListeners()
  armIdleTimer()
  // The first screen is already on the user's display before they scroll, so
  // take a reading now rather than waiting for a scroll that may never come
  // on a short article.
  session.noteScroll(window.innerHeight)
}

/**
 * Raises the watermark to a clicked word. The strongest signal available:
 * the user was demonstrably looking at that word, so the text above it has
 * been read.
 */
export function noteWordInteraction(reference: Range): void {
  if (!session) return
  session.noteInteraction(reference)
  flushIfProgressed()
}

/** Test seam: drop all state and listeners. */
export function __resetForTests(): void {
  if (scrollTimer !== null) window.clearTimeout(scrollTimer)
  if (idleTimer !== null) window.clearTimeout(idleTimer)
  scrollTimer = null
  idleTimer = null
  session = null
  send = null
  if (listening) {
    window.removeEventListener('scroll', onScroll)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', flush)
    listening = false
  }
}

/** Test seam: the live session, or null when nothing is being tracked. */
export function __currentSessionForTests(): ReadingSession | null {
  return session
}
