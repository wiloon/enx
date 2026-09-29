// adr-039: "Always enable on this site". A site is one exact origin, written
// as the match pattern Chrome grants optional host permissions for
// (`https://www.infoq.com/*`). The popup, the background and the content
// script all derive it the same way through this module.

export interface AutoEnableManifest {
  host_permissions?: string[]
  content_scripts?: { matches?: string[]; js?: string[] }[]
}

// scheme://host[:port]/* and nothing broader: no wildcard host, no path.
const SITE_PATTERN = /^https?:\/\/[^/*]+\/\*$/

export function isSitePattern(pattern: string): boolean {
  return SITE_PATTERN.test(pattern)
}

export function sitePatternFor(url: string | undefined): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  return `${parsed.origin}/*`
}

// A required host permission (api / enx-ui / Clerk) can't be removed, so a
// toggle there could never be switched off.
export function isRequiredHost(
  pattern: string,
  manifest: AutoEnableManifest
): boolean {
  return (manifest.host_permissions ?? []).includes(pattern)
}

export function autoEnableSiteFor(
  url: string | undefined,
  manifest: AutoEnableManifest
): string | null {
  const pattern = sitePatternFor(url)
  if (!pattern || isRequiredHost(pattern, manifest)) return null
  return pattern
}
