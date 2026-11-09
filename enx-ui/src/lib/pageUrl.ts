// The page URL a user may attach to feedback (ADR-076 Decision 3), cleaned
// the way enx-api's feedback.SanitizeURL and enx-chrome's sanitizePageUrl
// clean it, so the URL the user sees is the URL stored. The server re-cleans
// it and does not trust this copy; keep the three in step.

const MAX_SANITIZED_URL_LENGTH = 1024
const REDACTED = ':redacted'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

// An identifier that could name a person or grant access: an email, a UUID,
// or a long separator-free token. A 19-digit tweet id has no letters and a
// hyphenated slug has separators, so neither is caught.
function isOpaqueSegment(segment: string): boolean {
  const seg = safeDecode(segment)
  if (seg.includes('@') || UUID.test(seg)) return true
  if (/[-_.]/.test(seg)) return false
  if (seg.length >= 32) return true
  if (seg.length < 20) return false
  return /\p{L}/u.test(seg) && /\p{N}/u.test(seg)
}

/**
 * Reduces a page URL to origin + path: the query string, fragment and any
 * credentials are dropped and opaque path segments become ":redacted".
 * Returns null for anything that is not a plain http(s) page or is
 * unreasonably long.
 */
export function sanitizePageUrl(raw: string | undefined): string | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null

  const path = url.pathname
    .split('/')
    .map((segment) => (isOpaqueSegment(segment) ? REDACTED : segment))
    .join('/')

  const sanitized = `${url.protocol}//${url.host}${path || '/'}`
  return sanitized.length > MAX_SANITIZED_URL_LENGTH ? null : sanitized
}
