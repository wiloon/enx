// Prefetching the definitions of a page's highlighted words (ADR-079
// Decision 4), so a later click is a local dictionary cache hit. The content
// script picks the words; the worker reads the ones its cache lacks and
// stores them. Nothing is shown and no lookup is recorded, and every failure
// is silent: a missed prefetch only leaves the click to read the word itself.

import {
  entryToWordData,
  requestDictionaryEntries,
  type EntriesTransport,
  type EntriesTransportResult,
} from '@/lib/dictionaryEntries'
import { isReviewable, wordKey } from '@/lib/wordHighlight'
import type { WordData } from '@/types'

export const PREFETCH_BATCH_SIZE = 100

export interface PagePrefetch {
  /**
   * Sends the page words the loaded review list highlights, by cache key,
   * skipping every key already sent since the last reset.
   */
  request: (
    pageWords: readonly string[],
    states: Readonly<Record<string, WordData>>
  ) => void
  /** Forgets what was sent: a new page, an SPA rebuild or a sign-out. */
  reset: () => void
}

export function createPagePrefetch(
  send: (words: string[]) => void
): PagePrefetch {
  let sent = new Set<string>()
  return {
    request(pageWords, states) {
      const words: string[] = []
      for (const word of pageWords) {
        const key = wordKey(word.trim())
        const state = states[key]
        if (!key || sent.has(key) || !state || !isReviewable(state)) continue
        sent.add(key)
        words.push(key)
      }
      if (words.length > 0) send(words)
    },
    reset() {
      sent = new Set()
    },
  }
}

export interface PrefetchCache {
  /** A usable entry, read without counting as a use (no LRU refresh). */
  peek: (word: string) => Promise<unknown>
  put: (word: string, data: WordData) => Promise<void>
}

export interface DefinitionPrefetcherDeps<R extends EntriesTransportResult> {
  cache: PrefetchCache
  /** Sends one definitions request; it must not retry on its own. */
  send: EntriesTransport<R>
  /** Bumped on sign-out: a batch that sees it change writes nothing. */
  generation: () => number
}

export function createDefinitionPrefetcher<R extends EntriesTransportResult>(
  deps: DefinitionPrefetcherDeps<R>
) {
  const inFlight = new Set<string>()

  const isCached = async (key: string): Promise<boolean> => {
    try {
      return (await deps.cache.peek(key)) !== undefined
    } catch {
      return false
    }
  }

  const readBatch = async (keys: string[], generation: number) => {
    let response: R
    try {
      response = await requestDictionaryEntries(keys, deps.send)
    } catch {
      return
    }
    if (!response.success || !Array.isArray(response.data)) return
    const wanted = new Set(keys)
    for (const item of response.data as unknown[]) {
      const echoed = (item as { Word?: unknown } | null)?.Word
      if (typeof echoed !== 'string') continue
      const key = wordKey(echoed.trim())
      if (!wanted.has(key)) continue
      const data = entryToWordData(key, item)
      if (!data?.Id || data.Origin === 'ai') continue
      if (generation !== deps.generation()) return
      try {
        await deps.cache.put(key, data)
      } catch {
        /* Best effort: the click reads it again. */
      }
    }
  }

  return {
    async prefetch(words: readonly string[]): Promise<void> {
      const generation = deps.generation()
      const keys = [...new Set(words.map(word => wordKey(word.trim())))].filter(
        key => key && !inFlight.has(key)
      )
      keys.forEach(key => inFlight.add(key))
      try {
        const misses: string[] = []
        for (const key of keys) {
          if (!(await isCached(key))) misses.push(key)
        }
        for (let i = 0; i < misses.length; i += PREFETCH_BATCH_SIZE) {
          if (generation !== deps.generation()) return
          await readBatch(misses.slice(i, i + PREFETCH_BATCH_SIZE), generation)
        }
      } finally {
        keys.forEach(key => inFlight.delete(key))
      }
    },
  }
}
