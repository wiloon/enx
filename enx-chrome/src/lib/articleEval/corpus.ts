// ADR-075: what every article-eval corpus entry records, and the shape the
// corpus must keep. Imports nothing at runtime (see score.ts).

export const CORPUS_CATEGORIES = [
  'news',
  'tech-media',
  'blog-platform',
  'docs',
  'personal',
  'reference',
] as const

/** Why the site is in the corpus, whatever found its pages. */
export type SiteProvenance = 'hand-picked' | 'recommended'

export interface CorpusEntry {
  url: string
  category: (typeof CORPUS_CATEGORIES)[number]
  provenance: SiteProvenance
  /** Tranco rank of the site's registrable domain; null when it isn't listed. */
  trancoRank: number | null
  /**
   * A page added after ADR-075 without discovery, because discovery found no
   * usable page; hand-picked sites only. Pages carried over from before
   * ADR-075 are not marked.
   */
  handWritten?: true
}

/** A site is a hostname, and each site has exactly this many pages. */
export const PAGES_PER_SITE = 2

const PROVENANCES: readonly unknown[] = ['hand-picked', 'recommended']

const isRank = (value: unknown) =>
  value === null ||
  (typeof value === 'number' && Number.isInteger(value) && value > 0)

/** Every way the parsed corpus.json breaks the rules, one line each. */
export function corpusProblems(pages: unknown[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const sites = new Map<string, Array<Record<string, unknown>>>()

  for (const raw of pages) {
    const entry = (raw ?? {}) as Record<string, unknown>
    const url = String(entry.url)
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      problems.push(`${url}: not a URL`)
      continue
    }
    if (seen.has(url)) {
      problems.push(`${url}: listed twice`)
      continue
    }
    seen.add(url)
    if (!(CORPUS_CATEGORIES as readonly unknown[]).includes(entry.category)) {
      problems.push(`${url}: unknown category ${String(entry.category)}`)
    }
    if (!PROVENANCES.includes(entry.provenance)) {
      problems.push(`${url}: provenance must be hand-picked or recommended`)
    }
    if (!isRank(entry.trancoRank)) {
      problems.push(`${url}: trancoRank must be a positive integer or null`)
    }
    if ('handWritten' in entry) {
      if (entry.handWritten !== true) {
        problems.push(`${url}: handWritten must be true when present`)
      } else if (entry.provenance !== 'hand-picked') {
        problems.push(`${url}: handWritten is only for hand-picked sites`)
      }
    }
    sites.set(host, [...(sites.get(host) ?? []), entry])
  }

  for (const [host, entries] of sites) {
    if (entries.length !== PAGES_PER_SITE) {
      const pagesLabel = entries.length === 1 ? 'page' : 'pages'
      problems.push(
        `${host}: ${entries.length} ${pagesLabel}, expected ${PAGES_PER_SITE}`
      )
    }
    const [first, ...rest] = entries
    if (
      rest.some(
        entry =>
          entry.provenance !== first.provenance ||
          entry.trancoRank !== first.trancoRank
      )
    ) {
      problems.push(`${host}: pages disagree on provenance or trancoRank`)
    }
  }
  return problems
}
