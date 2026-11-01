// Learning mode loads a page's word data from paragraph-init in chunks of
// unique words, one after another. This is one chunk's request and its retry
// rule, kept apart from content.tsx so it runs on fakes.

import { isAccountDisabled } from '@/lib/accountDisabled'
import { isRequestRateLimited } from '@/lib/rateLimit'
import type { BackgroundResponse, WordData } from '@/types'

export interface WordChunkDeps {
  /** Sends one paragraph to paragraph-init through the background. */
  send: (paragraph: string) => Promise<BackgroundResponse>
  sleep: (ms: number) => Promise<void>
  /**
   * This run was superseded (a newer run from an SPA tweet switch, learning
   * mode turned off, or an orphaned script standing down): drop its answer.
   */
  isStale: () => boolean
}

export type WordChunkResult =
  | { kind: 'ok'; words: Record<string, WordData> }
  | { kind: 'session-expired' }
  /** Still refused by the request rate limit after waiting (ADR-060). */
  | { kind: 'rate-limited' }
  /** The admin disabled the account (ADR-062): retrying cannot help. */
  | { kind: 'account-disabled' }
  | { kind: 'failed' }
  | { kind: 'stale' }

const ATTEMPTS = 2
// A rate-limited retry waits Retry-After, and never less than this.
const MIN_RATE_LIMIT_WAIT_MS = 1000

// One retry covers a cold service worker or a transient error. A chunk the
// request rate limit refused waits Retry-After first: retrying at once would
// only be refused again (ADR-060 Decision 4).
export async function fetchWordChunk(
  chunk: string[],
  deps: WordChunkDeps
): Promise<WordChunkResult> {
  const paragraph = chunk.join(' ')
  let last: WordChunkResult = { kind: 'failed' }
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response: BackgroundResponse | undefined
    try {
      response = await deps.send(paragraph)
    } catch (error) {
      console.log(`Chunk error (attempt ${attempt})`, error)
    }
    if (deps.isStale()) return { kind: 'stale' }

    if (response?.success && response.wordProperties) {
      // Older servers wrap the word map in a `data` field.
      const wrapped = response.wordProperties as {
        data?: Record<string, WordData>
      }
      return { kind: 'ok', words: wrapped.data || response.wordProperties }
    }
    if (response?.sessionExpired) return { kind: 'session-expired' }
    if (response && isAccountDisabled(response)) {
      return { kind: 'account-disabled' }
    }

    if (response && isRequestRateLimited(response)) {
      last = { kind: 'rate-limited' }
      if (attempt < ATTEMPTS) {
        await deps.sleep(
          Math.max(response.retryAfterMs ?? 0, MIN_RATE_LIMIT_WAIT_MS)
        )
      }
    } else {
      last = { kind: 'failed' }
      if (response) {
        console.log(`Chunk failed (attempt ${attempt})`, response.error)
      }
    }
  }
  return last
}
