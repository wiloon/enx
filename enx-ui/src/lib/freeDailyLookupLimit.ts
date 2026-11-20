import { apiProxyUrl } from '@/lib/apiProxy'

const DEFAULT_TIMEOUT_MS = 3000

/**
 * Whether a value from GET /api/dictionary/free-daily-lookup-limit is safe
 * to show on the Free pricing card.
 */
export function usableFreeDailyLookupLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Effective free-tier daily lookup ceiling from enx-api (ADR-029). Returns
 * null when the upstream URL is missing or the response is unusable, so the
 * Free card can fall back to the no-number copy.
 */
export async function loadFreeDailyLookupLimit(
  options: {
    baseUrl?: string | undefined
    fetchImpl?: typeof fetch
    timeoutMs?: number
  } = {}
): Promise<number | null> {
  const baseUrl =
    options.baseUrl !== undefined ? options.baseUrl : process.env.API_BASE_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let url: URL | null
  try {
    url = apiProxyUrl('/api/dictionary/free-daily-lookup-limit', '', baseUrl)
  } catch {
    return null
  }
  if (!url) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url.href, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return null
    const body: unknown = await res.json()
    if (!body || typeof body !== 'object') return null
    const value = (body as { free_daily_lookup_limit?: unknown })
      .free_daily_lookup_limit
    return usableFreeDailyLookupLimit(value) ? value : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
