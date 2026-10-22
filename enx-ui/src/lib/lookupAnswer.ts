// What one lookup on /lookup answered.
// A lookup GET answers 200 whether the dictionary knew the word, did not
// know it, or did not answer in time; Source tells the last two apart
// (ADR-040). The client trusts the definition first, so an API that does not
// send Source yet, or sends a value this build doesn't know, reads as today.

import type { WordData } from '@/types'

// result: a definition to show and count. no-answer: the dictionary timed
// out or failed, so the word may well exist. miss: the dictionary knows no
// such word.
export type LookupAnswerKind = 'result' | 'no-answer' | 'miss'

export const classifyLookupAnswer = (word: WordData): LookupAnswerKind => {
  if (word.Chinese) return 'result'
  if (word.Source === 'timeout' || word.Source === 'error') return 'no-answer'
  return 'miss'
}

// The lookup source an admin sees beside the word's id: where this answer
// came from, the server's words table ("local") or ECDICT just now
// ("ecdict"). Never the browser's cache, and not the definition's Origin.
export const shownLookupSource = (
  source: string | undefined
): 'local' | 'ecdict' | null =>
  source === 'local' || source === 'ecdict' ? source : null
