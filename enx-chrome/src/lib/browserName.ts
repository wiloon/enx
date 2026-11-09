// The browser as feedback names it (ADR-076): name and major version, e.g.
// "Chrome 142", never the raw user-agent. enx-api accepts only this shape,
// and enx-ui's browserName.ts gives the same answers.

export interface BrowserIdentity {
  userAgent: string
  userAgentData?: { brands: { brand: string; version: string }[] }
}

const BRAND_NAMES: Record<string, string> = {
  'Google Chrome': 'Chrome',
  'Microsoft Edge': 'Edge',
  Opera: 'Opera',
}

// Most specific first: Edge and Opera also carry Chrome/ in their user-agent.
const UA_PATTERNS: [string, RegExp][] = [
  ['Edge', /\bEdg\/(\d+)/],
  ['Opera', /\bOPR\/(\d+)/],
  ['Firefox', /\bFirefox\/(\d+)/],
  ['Chrome', /\bChrome\/(\d+)/],
  ['Safari', /\bVersion\/(\d+)[\d.]* .*Safari\//],
]

function major(version: string): string | null {
  const m = /^(\d{1,4})/.exec(version)
  return m ? m[1] : null
}

/** Returns "Name Major", or '' when the browser cannot be told. */
export function browserName({
  userAgent,
  userAgentData,
}: BrowserIdentity): string {
  const brands = userAgentData?.brands ?? []
  const named = brands.find(b => BRAND_NAMES[b.brand])
  const chromium = brands.find(b => b.brand === 'Chromium')
  const brand = named ?? chromium
  const brandMajor = brand && major(brand.version)
  if (brand && brandMajor) {
    return `${BRAND_NAMES[brand.brand] ?? brand.brand} ${brandMajor}`
  }

  for (const [name, pattern] of UA_PATTERNS) {
    const m = pattern.exec(userAgent)
    if (m) return `${name} ${m[1].slice(0, 4)}`
  }
  return ''
}
