// ADR-070: the in-page half of the article-eval tool (article-eval/), bundled
// into an IIFE and injected into each corpus page. Not part of the extension
// build: nothing the manifest or its pages load imports this file.

import { Readability } from '@mozilla/readability'
import { extractText } from '@/lib/articleEval/extractText'
import { resolveLookupArea } from '@/lib/lookupArea'
import { lookupAreaOptions, resolveSiteAdapter } from '@/lib/siteAdapters'

export interface ProbeResult {
  adapter: string
  selector: string | null
  platform: string | null
  source: 'article' | 'whole-page'
  /** Set when layer 6 (ADR-077) found the article rather than a selector. */
  fallback?: 'json-ld-readability'
  /** How long layer 6 ran, when the page passed its gate. */
  layer6Ms?: number
  nodes: number
  chosenText: string
  referenceText: string | null
}

// No build target's own sites: the corpus is third-party pages.
const siteAdapter = () =>
  resolveSiteAdapter(window.location, { uiOrigins: [], rssxOrigins: [] })

/** The adapter's readySelector, for the caller to wait on before probe(). */
export function readySelector(): string | null {
  return siteAdapter().readySelector ?? null
}

// Readability's article text, or null when it finds none. It mutates the
// document it parses, so it gets a clone; its HTML is read in an inert
// document, so nothing in it runs or loads.
function referenceText(): string | null {
  const parsed = new Readability(document.cloneNode(true) as Document).parse()
  if (!parsed?.content) return null
  const article = new DOMParser().parseFromString(parsed.content, 'text/html')
  return extractText([article.body])
}

export async function probe(): Promise<ProbeResult> {
  const adapter = siteAdapter()
  // Layer 6 asks for Readability only once its gate passed: from then on,
  // the clone, parse, mapping and checks are its cost.
  let layer6Start: number | undefined
  const area = await resolveLookupArea(lookupAreaOptions(adapter), {
    loadReadability: () => {
      layer6Start = performance.now()
      return Promise.resolve(Readability)
    },
  })
  const layer6Ms =
    layer6Start === undefined ? undefined : performance.now() - layer6Start
  return {
    ...(layer6Ms === undefined ? {} : { layer6Ms }),
    adapter: adapter.name,
    selector: area.selector ?? null,
    platform: area.platform ?? null,
    source: area.source,
    ...(area.fallback ? { fallback: area.fallback } : {}),
    nodes: area.nodes.length,
    chosenText: extractText(area.nodes),
    referenceText: referenceText(),
  }
}
