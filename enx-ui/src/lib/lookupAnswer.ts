// What one lookup on /lookup answered, and what the page offers after it.
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

// A lookup GET that failed, with what the API client knew about why. status
// is the HTTP status of a non-2xx answer; networkFailure is set only when
// fetch itself got no answer. Neither is inferred from the message.
export class LookupFailure extends Error {
  readonly status?: number
  readonly networkFailure: boolean

  constructor(
    message: string,
    {
      status,
      networkFailure = false,
    }: { status?: number; networkFailure?: boolean }
  ) {
    super(message)
    this.name = 'LookupFailure'
    this.status = status
    this.networkFailure = networkFailure
  }
}

// Retry is offered where trying the same word again may well work: a 502 or
// 503 from the API, or no answer at all. Not for a 429, a 401, a disabled
// account or anything else, where the same request fails the same way.
export const canRetryLookup = (error: Error): boolean =>
  error instanceof LookupFailure &&
  (error.networkFailure || error.status === 502 || error.status === 503)
