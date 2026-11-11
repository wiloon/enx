// Reading definitions from enx-api's batch endpoint (ADR-079 Decision 1):
// QUERY /api/dictionary/entries with {"words": [...]}, retried once as
// POST /api/dictionary/entries/query when the network looks like it stopped
// the QUERY. ApiService supplies authentication and API error messages;
// this module decides only whether to fall back.

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
