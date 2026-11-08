// ADR-075: find a site's newest article pages for the article-eval corpus,
// from its RSS/Atom feeds and sitemaps. `article-eval/discover.ts` runs it
// with the network; nothing here does I/O or touches the DOM.

/** A page a feed or sitemap lists, with its publication date when known. */
export interface DiscoveredItem {
  url: string
  /** ISO timestamp from the feed's publication date or the sitemap's lastmod. */
  date: string | null
}

export interface Candidate extends DiscoveredItem {
  /** The feed or top-level sitemap that listed the page. */
  source: string
}

export interface DiscoveryFailure {
  url: string
  error: string
}

export interface DiscoveryResult {
  site: string
  candidates: Candidate[]
  failures: DiscoveryFailure[]
}

/** A response after redirects: `url` is the final URL. */
export interface FetchedResource {
  status: number
  url: string
  body: Uint8Array
}

export interface DiscoveryDeps {
  /** Throws when the request fails or times out. */
  fetch(url: string): Promise<FetchedResource>
  gunzip(bytes: Uint8Array): Uint8Array
}

export interface DiscoveryLimits {
  /** Articles per site. */
  wanted: number
  /** Every request counts: sources and candidate checks. */
  maxRequests: number
  /** Child sitemaps followed per sitemap index, newest first. */
  maxChildSitemaps: number
  /** How many sitemap indexes deep to follow. */
  maxIndexDepth: number
}

export const DISCOVERY_LIMITS: DiscoveryLimits = {
  wanted: 2,
  maxRequests: 40,
  maxChildSitemaps: 5,
  maxIndexDepth: 2,
}

/** Tried after the homepage feeds and robots.txt sitemaps, in this order. */
export const COMMON_SOURCE_PATHS = [
  '/feed',
  '/rss',
  '/feed.xml',
  '/rss.xml',
  '/atom.xml',
  '/index.xml',
  '/sitemap.xml',
  '/sitemap_index.xml',
]

const FEED_TYPES = new Set(['application/rss+xml', 'application/atom+xml'])

/** Path segments of listing and site pages, never of an article. */
const NON_ARTICLE_SEGMENTS = new Set([
  'tag',
  'tags',
  'category',
  'categories',
  'topic',
  'topics',
  'author',
  'authors',
  'page',
  'search',
  'feed',
  'rss',
  'archive',
  'archives',
  'wp-json',
  'wp-content',
  'about',
  'contact',
  'privacy',
  'privacy-policy',
  'terms',
  'login',
  'subscribe',
])

const NON_ARTICLE_FILE =
  /(^index\.[a-z]+$)|\.(xml|rss|atom|json|gz|jpe?g|png|gif|webp|svg|pdf|mp3|mp4|zip)$/i

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, name: string) => {
      if (name[0] === '#') {
        const code =
          name[1].toLowerCase() === 'x'
            ? parseInt(name.slice(2), 16)
            : parseInt(name.slice(1), 10)
        if (!Number.isFinite(code) || code > 0x10ffff) return match
        return String.fromCodePoint(code)
      }
      return ENTITIES[name.toLowerCase()] ?? match
    }
  )
}

function elementText(xml: string, tag: string): string | null {
  const match = new RegExp(
    `<${tag}(?:\\s[^>]*?)?(?<!/)>([\\s\\S]*?)</${tag}>`,
    'i'
  ).exec(xml)
  if (!match) return null
  const value = match[1].trim()
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value)
  return cdata ? cdata[1].trim() : decodeEntities(value)
}

function elements(xml: string, tag: string): string[] {
  const pattern = new RegExp(
    `<${tag}(?:\\s[^>]*?)?(?<!/)>([\\s\\S]*?)</${tag}>`,
    'gi'
  )
  return [...xml.matchAll(pattern)].map(match => match[1])
}

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  for (const match of tag.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4]
    )
  }
  return attrs
}

function resolve(href: string, base: string): string | null {
  try {
    return new URL(href, base).href
  } catch {
    return null
  }
}

function toDate(text: string | null): string | null {
  if (!text) return null
  const time = Date.parse(text)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/** The page's RSS and Atom `<link rel="alternate">` URLs. */
export function feedLinks(html: string, pageUrl: string): string[] {
  const links: string[] = []
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(tag)
    const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/)
    if (!rel.includes('alternate')) continue
    if (!FEED_TYPES.has((attrs.type ?? '').toLowerCase())) continue
    const url = attrs.href ? resolve(attrs.href, pageUrl) : null
    if (url) links.push(url)
  }
  return links
}

/** The `Sitemap:` URLs in a robots.txt. */
export function robotsSitemaps(robots: string, siteUrl: string): string[] {
  const sitemaps: string[] = []
  for (const line of robots.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line)
    const url = match ? resolve(match[1], siteUrl) : null
    if (url) sitemaps.push(url)
  }
  return sitemaps
}

function atomLink(entry: string): string | null {
  for (const [tag] of entry.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(tag)
    const rel = attrs.rel ?? 'alternate'
    if (rel === 'alternate' && attrs.href) return attrs.href
  }
  return null
}

/** The items of an RSS or Atom feed, in feed order. */
export function parseFeed(xml: string, feedUrl: string): DiscoveredItem[] {
  const items: DiscoveredItem[] = []
  for (const entry of [...elements(xml, 'item'), ...elements(xml, 'entry')]) {
    const href = elementText(entry, 'link') || atomLink(entry)
    const url = href ? resolve(href, feedUrl) : null
    if (!url) continue
    const date =
      elementText(entry, 'pubDate') ??
      elementText(entry, 'dc:date') ??
      elementText(entry, 'published') ??
      elementText(entry, 'updated')
    items.push({ url, date: toDate(date) })
  }
  return items
}

function sitemapEntries(blocks: string[]): DiscoveredItem[] {
  return blocks.flatMap(block => {
    const url = elementText(block, 'loc')
    if (!url) return []
    const date =
      elementText(block, 'lastmod') ??
      elementText(block, 'news:publication_date')
    return [{ url, date: toDate(date) }]
  })
}

/** A sitemap's pages, or a sitemap index's child sitemaps. */
export function parseSitemap(xml: string): {
  sitemaps: DiscoveredItem[]
  urls: DiscoveredItem[]
} {
  return {
    sitemaps: sitemapEntries(elements(xml, 'sitemap')),
    urls: sitemapEntries(elements(xml, 'url')),
  }
}

const bareHost = (host: string) => host.replace(/^www\./, '')

/**
 * Whether a URL can be one of the site's article pages: on the site or a
 * subdomain of it, and not the homepage, a listing, a site page or a file.
 */
export function isArticleUrl(url: string, siteUrl: string): boolean {
  let page: URL
  let site: URL
  try {
    page = new URL(url)
    site = new URL(siteUrl)
  } catch {
    return false
  }
  if (page.protocol !== 'https:' && page.protocol !== 'http:') return false
  const host = bareHost(page.hostname)
  const siteHost = bareHost(site.hostname)
  if (host !== siteHost && !host.endsWith(`.${siteHost}`)) return false
  const segments = page.pathname.split('/').filter(Boolean)
  if (segments.length === 0) return false
  if (segments.some(s => NON_ARTICLE_SEGMENTS.has(s.toLowerCase())))
    return false
  return !NON_ARTICLE_FILE.test(segments[segments.length - 1])
}

function withoutHash(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  return parsed.href
}

function newestFirst<T extends DiscoveredItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.date && b.date) return Date.parse(b.date) - Date.parse(a.date)
    if (a.date) return -1
    if (b.date) return 1
    return 0
  })
}

/**
 * The article pages among a source's items: newest first by date, undated
 * ones after them in source order, each URL once.
 */
export function selectArticles(
  items: DiscoveredItem[],
  siteUrl: string
): DiscoveredItem[] {
  const seen = new Set<string>()
  const selected: DiscoveredItem[] = []
  for (const item of newestFirst(items)) {
    if (!isArticleUrl(item.url, siteUrl)) continue
    const url = withoutHash(item.url)
    if (seen.has(url)) continue
    seen.add(url)
    selected.push({ url, date: item.date })
  }
  return selected
}

const isSuccess = (status: number) => status >= 200 && status < 300

const isGzip = (bytes: Uint8Array) =>
  bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b

/**
 * The site's newest article pages that answer 2xx. Sources are tried in
 * order: the homepage's feeds, robots.txt sitemaps, then common feed and
 * sitemap paths, until `wanted` articles are found or the request budget runs
 * out. Every failed source or candidate is in `failures`. `skip` lists pages
 * never to return, such as ones that failed screening.
 */
export async function discoverArticles(
  siteUrl: string,
  deps: DiscoveryDeps,
  limits: Partial<DiscoveryLimits> = {},
  skip: string[] = []
): Promise<DiscoveryResult> {
  const { wanted, maxRequests, maxChildSitemaps, maxIndexDepth } = {
    ...DISCOVERY_LIMITS,
    ...limits,
  }
  const candidates: Candidate[] = []
  const failures: DiscoveryFailure[] = []
  const requested = new Set<string>()
  const considered = new Set(skip.map(withoutHash))
  let exhausted = false
  const done = () => candidates.length >= wanted || exhausted

  const request = async (url: string): Promise<FetchedResource | null> => {
    if (requested.has(url)) return null
    if (requested.size >= maxRequests) {
      if (!exhausted) {
        failures.push({
          url: siteUrl,
          error: `stopped after ${maxRequests} requests`,
        })
      }
      exhausted = true
      return null
    }
    requested.add(url)
    try {
      return await deps.fetch(url)
    } catch (error) {
      failures.push({
        url,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  const fetchText = async (
    url: string
  ): Promise<{ text: string; url: string } | null> => {
    const response = await request(url)
    if (!response) return null
    if (!isSuccess(response.status)) {
      failures.push({ url, error: `HTTP ${response.status}` })
      return null
    }
    try {
      const bytes = isGzip(response.body)
        ? deps.gunzip(response.body)
        : response.body
      return { text: new TextDecoder().decode(bytes), url: response.url }
    } catch (error) {
      failures.push({
        url,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  const loadItems = async (
    url: string,
    depth: number
  ): Promise<DiscoveredItem[]> => {
    const resource = await fetchText(url)
    if (resource === null) return []
    try {
      return await parseSource(resource.text, resource.url, depth)
    } catch (error) {
      failures.push({
        url,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }

  const parseSource = async (
    text: string,
    url: string,
    depth: number
  ): Promise<DiscoveredItem[]> => {
    if (!/<(sitemapindex|urlset)[\s>]/i.test(text)) {
      return parseFeed(text, url)
    }
    const { sitemaps, urls } = parseSitemap(text)
    const items = [...urls]
    if (depth >= maxIndexDepth) return items
    for (const child of newestFirst(sitemaps).slice(0, maxChildSitemaps)) {
      if (exhausted) break
      items.push(...(await loadItems(child.url, depth + 1)))
    }
    return items
  }

  const trySource = async (source: string) => {
    if (done() || requested.has(source)) return
    const items = selectArticles(await loadItems(source, 0), siteUrl)
    for (const item of items) {
      if (done()) return
      if (considered.has(item.url)) continue
      considered.add(item.url)
      const response = await request(item.url)
      if (!response) continue
      if (!isSuccess(response.status)) {
        failures.push({ url: item.url, error: `HTTP ${response.status}` })
        continue
      }
      if (!isArticleUrl(response.url, siteUrl)) {
        failures.push({
          url: item.url,
          error: `redirected to a non-article page: ${response.url}`,
        })
        continue
      }
      const url = withoutHash(response.url)
      if (url !== item.url && considered.has(url)) continue
      considered.add(url)
      candidates.push({ url, date: item.date, source })
    }
  }

  const homepage = await fetchText(siteUrl)
  if (homepage !== null) {
    for (const feed of feedLinks(homepage.text, homepage.url))
      await trySource(feed)
  }
  if (!done()) {
    const robotsUrl = new URL('/robots.txt', siteUrl).href
    const robots = await fetchText(robotsUrl)
    if (robots !== null) {
      for (const sitemap of robotsSitemaps(robots.text, siteUrl)) {
        await trySource(sitemap)
      }
    }
  }
  for (const path of COMMON_SOURCE_PATHS) {
    await trySource(new URL(path, siteUrl).href)
  }

  if (candidates.length < wanted) {
    failures.push({
      url: siteUrl,
      error: `found ${candidates.length} of ${wanted} articles`,
    })
  }
  return { site: siteUrl, candidates, failures }
}
