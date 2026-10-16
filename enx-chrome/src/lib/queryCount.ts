// The query count (查词次数) of a word: how many times the user has looked it
// up. It decides the word's review bucket and so its underline colour
// (wordHighlight.ts). The lookup GET only reads it; one click-to-lookup adds
// one with POST /api/me/word-lookups (ADR-059 Decision 3).

import type { WordData } from '@/types'

// Sends POST /api/me/word-lookups for wordId. Fire and forget: never
// retried, never awaited, and a failure rolls nothing back -- the count is
// one short until the next lookup reads the server's number.
export type RecordLookup = (wordId: string) => void

// countLookup is what one click-to-lookup does with the word its lookup
// answered with: it records the lookup once and returns the word as it is
// now, one lookup on and back in review, so the popover and the underline
// show it without waiting for the server. A miss has no word id, nothing to
// count, and is returned as it was.
//
// Call it once per click, on a lookup's own answer only: a card that only
// mirrors a lookup made elsewhere (the Side Panel's copy of a popover
// lookup) must not count it again.
export const countLookup = (word: WordData, record: RecordLookup): WordData => {
  if (!word.Id) return word
  record(word.Id)
  return { ...word, LoadCount: (word.LoadCount ?? 0) + 1, Known: false }
}
