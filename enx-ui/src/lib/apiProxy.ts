// Where a browser request for `/api/*` is forwarded to.
//
// The browser only ever talks to its own origin; this server relays `/api/*`
// to the real API. The target MUST be read per request (from proxy.ts), not
// from next.config.ts `rewrites()`: rewrites are evaluated at `next build` and
// frozen into routes-manifest.json, so the API host would be baked into the
// image and `API_BASE_URL` set on the container would do nothing.

export const API_PREFIX = '/api'

export function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)
}

/**
 * Absolute URL the request is relayed to, or null when `base` is unset/blank.
 * There is deliberately no default: a missing value must fail loudly rather
 * than quietly point production at another environment's API.
 */
export function apiProxyUrl(
  pathname: string,
  search: string,
  base: string | undefined
): URL | null {
  const trimmed = base?.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  return new URL(`${trimmed}${pathname}${search}`)
}
