// enx-api answers 429 for several unrelated reasons; the response's `code`
// says which (ADR-060 Decision 4). The request rate limit is a "slow down",
// the daily lookup quota a product limit with an upgrade path -- showing one
// as the other either upsells someone who only clicked fast or hides the
// real reason a lookup failed.

export interface HttpFailure {
  status?: number
  code?: string
  retryAfterMs?: number
}

export const REQUEST_RATE_LIMITED = 'too_many_requests'
const LOOKUP_QUOTA_EXCEEDED = 'lookup_quota_exceeded'

/** The per-user request rate limit refused this request: wait and retry. */
export const isRequestRateLimited = (r: HttpFailure): boolean =>
  r.status === 429 && r.code === REQUEST_RATE_LIMITED

/** The daily dictionary lookup quota is used up. A 429 with no code comes
 *  from a server older than the codes and keeps meaning the quota. */
export const isLookupQuotaExceeded = (r: HttpFailure): boolean =>
  r.status === 429 && (r.code === undefined || r.code === LOOKUP_QUOTA_EXCEEDED)
