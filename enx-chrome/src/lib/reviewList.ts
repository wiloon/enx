// Learning mode underlines from the user's review list (ADR-069 Decision 1):
// one request per page, carrying no page text, answered with every word the
// user looked up and has not marked known. This module holds the request's
// retry rules and the list's lifecycle in the content script, apart from
// content.tsx so both run on fakes.

import { isAccountDisabled } from '@/lib/accountDisabled'
import { isRequestRateLimited } from '@/lib/rateLimit'
import { wordKey } from '@/lib/wordHighlight'
import type { BackgroundResponse, WordData } from '@/types'

export type ReviewListFailure =
  /** Still refused by the request rate limit after waiting (ADR-060). */
  | 'rate-limited'
  | 'session-expired'
  /** The admin disabled the account (ADR-062): retrying cannot help. */
  | 'account-disabled'
  | 'lookup-failed'

export type ReviewListResult =
  | { ok: true; words: Record<string, WordData> }
  | { ok: false; reason: ReviewListFailure }

export interface ReviewListRequestDeps {
  /** Asks the background for the list. */
  send: () => Promise<BackgroundResponse>
  sleep: (ms: number) => Promise<void>
}

const ATTEMPTS = 2
// A rate-limited retry waits Retry-After, and never less than this.
const MIN_RATE_LIMIT_WAIT_MS = 1000

// The list's [english, queryCount] pairs as the word states the page
// underlines from. Entries of any other shape are skipped.
const toWordStates = (entries: unknown[]): Record<string, WordData> => {
  const words: Record<string, WordData> = {}
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue
    const [english, count] = entry
    if (typeof english !== 'string' || typeof count !== 'number') continue
    words[wordKey(english)] = {
      Key: english.toLowerCase(),
      English: english,
      Pronunciation: '',
      Chinese: '',
      LoadCount: count,
      Known: false,
      WordType: 0,
    }
  }
  return words
}

// One retry covers a cold service worker or a transient error. A request the
// rate limit refused waits Retry-After first: retrying at once would only be
// refused again (ADR-060 Decision 4).
export async function requestReviewList(
  deps: ReviewListRequestDeps
): Promise<ReviewListResult> {
  let last: ReviewListFailure = 'lookup-failed'
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let response: BackgroundResponse | undefined
    try {
      response = await deps.send()
    } catch (error) {
      console.log(`Review list error (attempt ${attempt})`, error)
    }

    if (response?.success) {
      if (!Array.isArray(response.reviewWords)) {
        return { ok: false, reason: 'lookup-failed' }
      }
      return { ok: true, words: toWordStates(response.reviewWords) }
    }
    if (response?.sessionExpired)
      return { ok: false, reason: 'session-expired' }
    if (response && isAccountDisabled(response)) {
      return { ok: false, reason: 'account-disabled' }
    }

    if (response && isRequestRateLimited(response)) {
      last = 'rate-limited'
      if (attempt < ATTEMPTS) {
        await deps.sleep(
          Math.max(response.retryAfterMs ?? 0, MIN_RATE_LIMIT_WAIT_MS)
        )
      }
    } else {
      last = 'lookup-failed'
      if (response) {
        console.log(`Review list failed (attempt ${attempt})`, response.error)
      }
    }
  }
  return { ok: false, reason: last }
}

export type ReviewListLoad =
  { ok: true } | { ok: false; reason: ReviewListFailure }

export interface ReviewListDeps extends ReviewListRequestDeps {
  /** The page's word states, keyed by wordKey; the list fills it. */
  cache: Record<string, WordData>
  /** This script stood down (#561): it must not fill anything any more. */
  isStoodDown: () => boolean
}

export interface ReviewList {
  /**
   * Loads the list into the cache once per page. A successful load is
   * reused; a request in flight is shared; a failed one is not remembered.
   */
  load: () => Promise<ReviewListLoad>
  /** Forgets the list and empties the cache (the session expired). */
  clear: () => void
}

export function createReviewList(deps: ReviewListDeps): ReviewList {
  const { cache } = deps
  let loaded = false
  let inFlight: Promise<ReviewListLoad> | null = null
  // Bumped by clear(), so a response to an older request fills nothing.
  let generation = 0

  const clear = () => {
    generation++
    loaded = false
    inFlight = null
    for (const key of Object.keys(cache)) delete cache[key]
  }

  const load = (): Promise<ReviewListLoad> => {
    if (loaded) return Promise.resolve({ ok: true })
    if (inFlight) return inFlight

    const requested = generation
    inFlight = requestReviewList(deps).then((result): ReviewListLoad => {
      if (requested !== generation)
        return { ok: false, reason: 'session-expired' }
      inFlight = null
      if (!result.ok) {
        if (result.reason === 'session-expired') clear()
        return result
      }
      if (deps.isStoodDown()) return { ok: true }
      // A lookup made while the request was out is newer than the list.
      for (const [key, state] of Object.entries(result.words)) {
        if (!(key in cache)) cache[key] = state
      }
      loaded = true
      return { ok: true }
    })
    return inFlight
  }

  return { load, clear }
}
