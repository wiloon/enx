import type { Readability } from '@mozilla/readability'
import {
  WordProcessor,
  type LookupArea,
  type LookupAreaOptions,
} from '@/lib/wordProcessor'

export interface LookupAreaDeps {
  /** Loads Readability on demand: only pages that pass the gate pay for it. */
  loadReadability: () => Promise<typeof Readability>
}

const INDEX_ATTRIBUTE = 'data-enx-layer6'

const ARTICLE_TYPES = new Set(['BlogPosting', 'LiveBlogPosting', 'APIReference'])

// Only these keys nest the page's own entity; following every key would let
// a listing's hasPart or itemListElement articles pass the gate.
const NESTING_KEYS = ['@graph', 'mainEntity', 'mainEntityOfPage']

function isArticleType(type: unknown): boolean {
  return (
    typeof type === 'string' &&
    (type.endsWith('Article') || ARTICLE_TYPES.has(type))
  )
}

function declaresArticleIn(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(declaresArticleIn)
  if (!value || typeof value !== 'object') return false
  const entity = value as Record<string, unknown>
  const type = entity['@type']
  if (Array.isArray(type) ? type.some(isArticleType) : isArticleType(type)) {
    return true
  }
  return NESTING_KEYS.some(key => declaresArticleIn(entity[key]))
}

function declaresArticle(doc: Document): boolean {
  for (const script of doc.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    let data: unknown
    try {
      data = JSON.parse(script.textContent ?? '')
    } catch {
      continue
    }
    if (declaresArticleIn(data)) return true
  }
  return false
}

// Readability's article, mapped back onto the page: the lowest common
// ancestor of the page elements its output kept. It parses a clone whose
// elements carry their index in the page, so the page itself is untouched.
function readabilityNode(
  doc: Document,
  ReadabilityClass: typeof Readability
): Element | null {
  const pageElements = Array.from(doc.body.querySelectorAll('*'))
  const clone = doc.cloneNode(true) as Document
  clone.body
    .querySelectorAll('*')
    .forEach((element, index) =>
      element.setAttribute(INDEX_ATTRIBUTE, String(index))
    )
  const parsed = new ReadabilityClass(clone).parse()
  if (!parsed?.content) return null
  const output = new DOMParser().parseFromString(parsed.content, 'text/html')
  const kept = Array.from(output.querySelectorAll(`[${INDEX_ATTRIBUTE}]`))
    .map(element => pageElements[Number(element.getAttribute(INDEX_ATTRIBUTE))])
    .filter((element): element is Element => element !== undefined)
  if (kept.length === 0) return null
  let ancestor: Element | null = kept[0]
  for (const element of kept.slice(1)) {
    while (ancestor && !ancestor.contains(element)) {
      ancestor = ancestor.parentElement
    }
  }
  return ancestor
}

const MIN_TEXT_LENGTH = 500
const MAX_LINK_DENSITY = 0.2

const collapse = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

// Text length and link density measured as ADR-077 measured them: without
// script, style and noscript, whitespace collapsed.
function measure(node: Element): { length: number; linkDensity: number } {
  const copy = node.cloneNode(true) as Element
  copy.querySelectorAll('script, style, noscript').forEach(el => el.remove())
  const length = collapse(copy.textContent).length
  let linkLength = 0
  copy.querySelectorAll('a').forEach(link => {
    if (!link.parentElement?.closest('a')) {
      linkLength += collapse(link.textContent).length
    }
  })
  return { length, linkDensity: length ? linkLength / length : 0 }
}

function qualifies(node: Element, doc: Document): boolean {
  if (node === doc.body || node === doc.documentElement) return false
  const { length, linkDensity } = measure(node)
  return length >= MIN_TEXT_LENGTH && linkDensity <= MAX_LINK_DENSITY
}

// Layers 1-5 and the whole page come from WordProcessor.findLookupArea; when
// they end in the whole page, layer 6 (ADR-077) gets one more try.
export async function resolveLookupArea(
  options: LookupAreaOptions,
  deps: LookupAreaDeps
): Promise<LookupArea> {
  const area = WordProcessor.findLookupArea(options)
  // An adapter with its own contentSelector keeps its behaviour (ADR-010,
  // ADR-071), whole-page fallback included.
  if (
    options.contentSelector ||
    area.source !== 'whole-page' ||
    !declaresArticle(document)
  ) {
    return area
  }
  let node: Element | null
  try {
    node = readabilityNode(document, await deps.loadReadability())
  } catch (error) {
    // Learning mode still opens on the whole page.
    console.warn('[ENX] layer 6 failed, using the whole page', error)
    return area
  }
  if (!node || !qualifies(node, document)) return area
  return { nodes: [node], source: 'article', fallback: 'json-ld-readability' }
}
