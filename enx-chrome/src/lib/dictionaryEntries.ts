// Reading definitions from enx-api's batch endpoint (ADR-079 Decision 1):
// QUERY /api/dictionary/entries with {"words": [...]}, retried once as
// POST /api/dictionary/entries/query when the network looks like it stopped
// the QUERY. The transport carries its own retry policy and token refresh;
// this decides only whether to fall back and what an answer means.

import { wordKey } from '@/lib/wordHighlight'
import type { WordData } from '@/types'

export const ENTRIES_PATH = '/api/dictionary/entries'
export const ENTRIES_FALLBACK_PATH = '/api/dictionary/entries/query'

export interface EntriesTransportResult {
  success: boolean
  status?: number
  // fetch itself failed: no response at all.
  networkError?: boolean
  data?: unknown
}

export type EntriesTransport<R extends EntriesTransportResult> = (
  method: 'QUERY' | 'POST',
  path: string,
  body: string
) => Promise<R>

// A method refused on the way (405, 501), or a body or content type stripped
// by a proxy (400, 415). An invalid batch also answers 400; neither is
// charged, so one replay costs nothing. 401, 429 and 5xx are real answers.
const FALLBACK_STATUSES = new Set([400, 405, 415, 501])

const shouldFallBack = (result: EntriesTransportResult): boolean =>
  !result.success &&
  (result.networkError === true ||
    (result.status !== undefined && FALLBACK_STATUSES.has(result.status)))

export async function requestDictionaryEntries<
  R extends EntriesTransportResult,
>(words: string[], send: EntriesTransport<R>): Promise<R> {
  const body = JSON.stringify({ words })
  const first = await send('QUERY', ENTRIES_PATH, body)
  if (!shouldFallBack(first)) return first
  return send('POST', ENTRIES_FALLBACK_PATH, body)
}

interface EntryItem {
  Word?: string
  Status?: string
  Id?: string
  English?: string
  Pronunciation?: string
  Chinese?: string
  WordType?: number
  Origin?: WordData['Origin']
  AIFallback?: WordData['AIFallback']
}

// One entry as the popover's WordData, for the word the user asked about.
// `found` is the definition (Id absent when the server could not store it);
// `not_found` is an empty definition of the requested word that carries the
// AI fallback offer (lib/aiLookupFlow.ts); `failed` and anything malformed
// have no definition.
export const entryToWordData = (
  requested: string,
  item: unknown
): WordData | undefined => {
  if (!item || typeof item !== 'object') return undefined
  const entry = item as EntryItem
  const Key = wordKey(requested.trim())
  if (entry.Status === 'found') {
    return {
      ...(entry.Id ? { Id: entry.Id } : {}),
      Key,
      English: entry.English || requested,
      Pronunciation: entry.Pronunciation ?? '',
      Chinese: entry.Chinese ?? '',
      WordType: entry.WordType ?? 0,
      ...(entry.Origin ? { Origin: entry.Origin } : {}),
    }
  }
  if (entry.Status === 'not_found') {
    return {
      Key,
      English: requested,
      Pronunciation: '',
      Chinese: '',
      WordType: 0,
      ...(entry.AIFallback ? { AIFallback: entry.AIFallback } : {}),
    }
  }
  return undefined
}

// A single-word request's answer, mapped to the requested click whatever
// normalized form the server echoes in `Word`.
export const definitionFromEntries = (
  requested: string,
  data: unknown
): WordData | undefined =>
  Array.isArray(data) ? entryToWordData(requested, data[0]) : undefined
