// ADR-070: how well the area learning mode picks matches the page's article.
// The reference article is Mozilla Readability's; the chosen area is what
// WordProcessor.findLookupArea() returned for the page's site adapter.
//
// The article-eval tool runs this module under Node's type stripping, so it
// imports nothing but types.

/**
 * Verdict thresholds. Coverage is the share of the reference text inside the
 * chosen area; below 0.8 the area misses a paragraph or more of a typical
 * article. Precision is the share of the chosen text that is reference text;
 * below 0.7 the area carries navigation, link lists or comments on top of it.
 */
export const COVERAGE_MIN = 0.8
export const PRECISION_MIN = 0.7

/** Words per shingle: long enough that common phrases rarely match by chance. */
const SHINGLE_WORDS = 5

export type Verdict =
  | 'ok'
  | 'misses text'
  | 'too broad'
  | 'whole page'
  | 'no article node'
  | 'no reference'
  | 'load failed'

export type Observation =
  | { status: 'load-failed'; error: string }
  | {
      status: 'loaded'
      source: 'article' | 'whole-page'
      /** How many nodes the lookup area holds. */
      nodes: number
      chosenText: string
      /** Readability's article text; null when it found none. */
      referenceText: string | null
    }

/** A score is null when it is unavailable, never a made-up number. */
export interface Score {
  coverage: number | null
  precision: number | null
  verdict: Verdict
}

// Lower-cased words, so case, whitespace and punctuation don't count.
function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []
}

// Overlapping runs of SHINGLE_WORDS words: comparing sets of them keeps
// reordered blocks and markup differences from dominating. A text shorter
// than one shingle is one shingle.
function shingles(text: string): Set<string> {
  const list = words(text)
  if (list.length === 0) return new Set()
  if (list.length <= SHINGLE_WORDS) return new Set([list.join(' ')])
  const result = new Set<string>()
  for (let i = 0; i + SHINGLE_WORDS <= list.length; i++) {
    result.add(list.slice(i, i + SHINGLE_WORDS).join(' '))
  }
  return result
}

function overlap(reference: Set<string>, chosen: Set<string>) {
  let shared = 0
  for (const shingle of chosen) if (reference.has(shingle)) shared++
  return {
    coverage: shared / reference.size,
    precision: chosen.size === 0 ? 0 : shared / chosen.size,
  }
}

export function scorePage(observation: Observation): Score {
  if (observation.status === 'load-failed') {
    return { coverage: null, precision: null, verdict: 'load failed' }
  }
  const reference = shingles(observation.referenceText ?? '')
  const hasReference = reference.size > 0

  if (observation.source === 'article' && observation.nodes === 0) {
    return hasReference
      ? { coverage: 0, precision: 0, verdict: 'no article node' }
      : { coverage: null, precision: null, verdict: 'no article node' }
  }
  if (observation.source === 'whole-page') {
    return { coverage: 0, precision: null, verdict: 'whole page' }
  }
  if (!hasReference) {
    return { coverage: null, precision: null, verdict: 'no reference' }
  }

  const { coverage, precision } = overlap(
    reference,
    shingles(observation.chosenText)
  )
  const verdict: Verdict =
    coverage < COVERAGE_MIN
      ? 'misses text'
      : precision < PRECISION_MIN
        ? 'too broad'
        : 'ok'
  return { coverage, precision, verdict }
}
