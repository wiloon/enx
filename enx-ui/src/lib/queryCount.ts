// The query count (查词次数) of a word: how many times the user has looked it
// up. The lookup GET only reads it; one lookup -- a submit on /lookup, like a
// click in the extension -- adds one with POST /api/me/word-lookups
// (ADR-059 Decision 3). Same rule as enx-chrome's src/lib/queryCount.ts,
// which the enx-ui build cannot import.

import type { WordData } from '@/types'

// Sends POST /api/me/word-lookups for wordId. Fire and forget: never
// retried, never awaited, and a failure rolls nothing back -- the count is
// one short until the next lookup reads the server's number.
export type RecordLookup = (wordId: string) => void

// countLookup is what one lookup does with the word its GET answered with:
// it records the lookup once, by the answer's id (the GET may resolve "ran"
// to "run"), and returns the word one lookup on and back in review, so the
// card shows it without waiting for the server. An answer without an id (a
// miss, or a definition the API could not cache) has nothing to count and
// is returned as it was.
export const countLookup = (word: WordData, record: RecordLookup): WordData => {
  if (!word.Id) return word
  record(word.Id)
  return { ...word, LoadCount: (word.LoadCount ?? 0) + 1, Known: false }
}
