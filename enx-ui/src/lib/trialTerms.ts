import { apiProxyUrl } from '@/lib/apiProxy'

const DEFAULT_TIMEOUT_MS = 3000

/**
 * Sign-up trial offer from GET /api/billing/trial-terms (ADR-098 Decision 9).
 * - terms: both amount and ttl_days are positive safe integers
 * - off: either field is 0 (trial switched off; do not advertise)
 * - unknown: missing base URL, non-OK response, timeout, or unusable body
 */
export type TrialTerms =
  | { status: 'terms'; amount: number; ttlDays: number }
  | { status: 'off' }
  | { status: 'unknown' }

function usableNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Effective sign-up trial amount and length from enx-api. Distinguishes an
 * intentional off offer from a failed fetch so /pricing and /welcome can hide
 * the trial line without guessing numbers.
 */
export async function loadTrialTerms(
  options: {
    baseUrl?: string | undefined
    fetchImpl?: typeof fetch
    timeoutMs?: number
  } = {}
): Promise<TrialTerms> {
  const baseUrl =
    options.baseUrl !== undefined ? options.baseUrl : process.env.API_BASE_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let url: URL | null
  try {
    url = apiProxyUrl('/api/billing/trial-terms', '', baseUrl)
  } catch {
    return { status: 'unknown' }
  }
  if (!url) return { status: 'unknown' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url.href, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return { status: 'unknown' }
    const body: unknown = await res.json()
    if (!body || typeof body !== 'object') return { status: 'unknown' }
    const amount = (body as { amount?: unknown }).amount
    const ttlDays = (body as { ttl_days?: unknown }).ttl_days
    if (!usableNonNegativeInt(amount) || !usableNonNegativeInt(ttlDays)) {
      return { status: 'unknown' }
    }
    if (amount === 0 || ttlDays === 0) return { status: 'off' }
    return { status: 'terms', amount, ttlDays }
  } catch {
    return { status: 'unknown' }
  } finally {
    clearTimeout(timer)
  }
}
