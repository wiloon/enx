// ADR-010: per-site behavior differences that don't fit getArticleNodes()'s
// flat selector list — the text-length threshold, which matched node is the
// one to process, how highlights are written into the DOM, and whether to
// show the completion indicator.
//
// resolveSiteAdapter() returns DEFAULT_ADAPTER for every site currently in
// manifest.json's content-script whitelist; its field values reproduce
// today's behavior field-for-field, so those sites must see no observable
// change. Only X (a React SPA) needs a non-default adapter.

export type HighlightStrategy = 'innerHTML' | 'inPlace'

export interface SiteAdapter {
  name: string
  /** Host-level match against window.location. */
  matches: (location: Location) => boolean
  /**
   * Page-level gate evaluated after `matches` succeeds. Returns a user-facing
   * string when this specific page is out of scope (e.g. an X timeline or
   * search page rather than a tweet detail page) — enxRun then aborts and
   * surfaces that message. Returns null when the page is supported. Undefined
   * means every page under the matched host is supported (today's behavior).
   */
  pageSupport?: (location: Location) => string | null
  /** Overrides getArticleNodes()'s built-in selector list when set. */
  contentSelector?: string
  /** Minimum trimmed textContent length for a node to count as content. */
  minTextLength: number
  /**
   * Narrows the selector matches down to the node(s) actually worth
   * processing. Undefined = process every match (today's behavior).
   */
  focusedNodeResolver?: (nodes: Element[]) => Element[]
  highlightStrategy: HighlightStrategy
  showProcessingIndicator: boolean
}

// Field-for-field equal to today's hard-coded behavior. Every whitelisted
// article site resolves to this.
export const DEFAULT_ADAPTER: SiteAdapter = {
  name: 'default',
  matches: () => true,
  minTextLength: 100,
  highlightStrategy: 'innerHTML',
  showProcessingIndicator: true,
}

// --- X (Twitter) -----------------------------------------------------------
// ADR-010 Phase 1: the main tweet body on a tweet-detail page only.

const X_HOST = /(^|\.)(x|twitter)\.com$/
const TWEET_DETAIL_PATH = /^\/[^/]+\/status\/\d+/

// From the div[data-testid="tweetText"] nodes on a tweet-detail page (which
// can also include ancestor tweets and the author's self-thread), pick the
// one tweet the user opened. Criteria are tried in descending order of
// expected reliability (ADR-010 premise §2.2 / Options B'1); when none
// resolves a unique node, falls back to DOM order (Options B'2) — correct on
// a standalone tweet page, potentially wrong on a conversation page.
export function pickFocusedTweet(nodes: Element[]): Element[] {
  if (nodes.length <= 1) return nodes

  // 1. The focused tweet's <article> has tabindex="-1"; replies/ancestors "0".
  const byTabindex = nodes.filter(
    n => n.closest('article')?.getAttribute('tabindex') === '-1'
  )
  if (byTabindex.length === 1) return byTabindex

  // 2. The focused tweet's body renders visibly larger (~23px vs ~15px).
  const sized = nodes.map(n => ({
    node: n,
    size: parseFloat(getComputedStyle(n).fontSize) || 0,
  }))
  const maxSize = Math.max(...sized.map(s => s.size))
  const largest = sized.filter(s => s.size === maxSize && maxSize > 0)
  if (largest.length === 1) return [largest[0].node]

  // 3. Ancestor/reply <article>s link to their own /status/ permalink; the
  //    focused tweet's does not (its permalink is the current URL).
  const withoutSelfLink = nodes.filter(
    n => !n.closest('article')?.querySelector('a[href*="/status/"]')
  )
  if (withoutSelfLink.length === 1) return withoutSelfLink

  console.warn(
    `[enx] pickFocusedTweet: no criterion resolved a single main tweet ` +
      `(${nodes.length} candidates); falling back to DOM order`
  )
  return [nodes[0]]
}

const X_ADAPTER: SiteAdapter = {
  name: 'x',
  matches: location => X_HOST.test(location.hostname),
  pageSupport: location =>
    TWEET_DETAIL_PATH.test(location.pathname)
      ? null
      : 'ENX 目前只支持 X 的推文详情页，请先点开一条推文',
  contentSelector: 'div[data-testid="tweetText"]',
  // A tweet body caps at 280 chars and short tweets fall well under the
  // default 100; >1 still filters out pure-emoji / pure-link empty nodes.
  minTextLength: 1,
  focusedNodeResolver: pickFocusedTweet,
  highlightStrategy: 'inPlace',
  showProcessingIndicator: false,
}

// Non-default adapters, checked in order.
const ADAPTERS: SiteAdapter[] = [X_ADAPTER]

export function resolveSiteAdapter(location: Location): SiteAdapter {
  return ADAPTERS.find(adapter => adapter.matches(location)) ?? DEFAULT_ADAPTER
}
