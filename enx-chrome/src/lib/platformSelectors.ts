// ADR-072 decision 2: platform selectors. A CMS or doc generator puts its
// article in a fixed class, but that class alone over-matches on other
// sites (#709), so each rule runs only when its platform signal is on the
// page. A signal must identify the platform, not repeat a generic article
// selector.

export interface PlatformSignal {
  /** Case-insensitive substring of a `<meta name="generator">` content. */
  generator?: string
  /** An element only this platform puts on its pages. */
  selector?: string
}

export interface PlatformRule {
  platform: string
  signal: PlatformSignal
  /** Tried in order, each with the broad-selector rule. */
  selectors: readonly string[]
}

export const PLATFORM_RULES: readonly PlatformRule[] = [
  {
    platform: 'wordpress',
    // The REST API discovery link: self-hosted sites often drop the
    // generator meta but keep this.
    signal: {
      generator: 'wordpress',
      selector: 'link[rel="https://api.w.org/"]',
    },
    selectors: ['.entry-content'],
  },
  {
    platform: 'ghost',
    signal: { generator: 'ghost' },
    selectors: ['.gh-content'],
  },
  {
    platform: 'substack',
    signal: { selector: 'link[href^="https://substackcdn.com/"]' },
    selectors: ['.available-content'],
  },
  {
    platform: 'blogger',
    signal: { generator: 'blogger' },
    selectors: ['.post-body'],
  },
  {
    platform: 'sphinx',
    // Sphinx themes such as docs.python.org's emit no generator meta.
    signal: {
      selector:
        'script[src*="documentation_options.js"], script[src*="sphinx_highlight.js"]',
    },
    selectors: ['div.body', '[role="main"]'],
  },
  {
    platform: 'docusaurus',
    signal: { generator: 'docusaurus' },
    selectors: ['.theme-doc-markdown'],
  },
]

function hasPlatformSignal(
  page: ParentNode,
  { generator, selector }: PlatformSignal
): boolean {
  if (generator) {
    const needle = generator.toLowerCase()
    const generators = Array.from(
      page.querySelectorAll('meta[name="generator"]')
    )
    if (
      generators.some(meta =>
        (meta.getAttribute('content') ?? '').toLowerCase().includes(needle)
      )
    ) {
      return true
    }
  }
  return selector ? page.querySelector(selector) !== null : false
}

/** The rules whose signal is on the page, in rule order. */
export function platformRulesOn(page: ParentNode): PlatformRule[] {
  return PLATFORM_RULES.filter(rule => hasPlatformSignal(page, rule.signal))
}
