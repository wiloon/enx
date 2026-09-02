// Per-site behavior differences that don't fit getArticleNodes()'s flat
// selector list — the text-length threshold, which matched node is the one
// to process, how volatile the content is, and whether to show the
// completion indicator (ADR-010, ADR-011 Decision 4).
//
// resolveSiteAdapter() returns DEFAULT_ADAPTER for every site currently in
// manifest.json's content-script whitelist; its field values reproduce
// today's behavior field-for-field, so those sites must see no observable
// change. Only X (a React SPA) needs a non-default adapter.

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
  /**
   * How the article content changes after learning mode is on, and so which
   * observers the content script attaches (ADR-011 F section):
   *   'static'    — no observers; re-run only on an explicit enxRun.
   *   'spa'       — a route-change listener re-runs on in-page navigation.
   *   'streaming' — incremental MutationObserver (ADR-010 Phase 3/4).
   * Only 'static' is wired today; 'spa' is a placeholder for issue #12.
   */
  contentVolatility: 'static' | 'spa' | 'streaming'
  /**
   * Where the delegated click-to-lookup listener binds (ADR-011 Decision 2 /
   * ADR-010 Options F3). Defaults to 'bubble'; 'documentCapture' is a
   * placeholder, not yet implemented.
   */
  clickBinding?: 'bubble' | 'documentCapture'
  showProcessingIndicator: boolean
}

// Field-for-field equal to today's hard-coded behavior. Every whitelisted
// article site resolves to this.
export const DEFAULT_ADAPTER: SiteAdapter = {
  name: 'default',
  matches: () => true,
  minTextLength: 100,
  contentVolatility: 'static',
  showProcessingIndicator: true,
}

// --- X (Twitter) -----------------------------------------------------------
// ADR-010 Phase 1: the main tweet body on a tweet-detail page only.

const X_HOST = /(^|\.)(x|twitter)\.com$/
const TWEET_DETAIL_PATH = /^\/[^/]+\/status\/\d+/

// From the div[data-testid="tweetText"] nodes on a tweet-detail page (which
// can also include ancestor tweets, the author's self-thread, and a quoted
// tweet's body), pick the one tweet body the user opened.
//
// The only reliable signal (browser-tested, adr-010-phase2-dom-readiness.md
// §3): the opened tweet's <article> has tabindex="-1", ancestors/replies
// have "0". The earlier font-size and "no self /status/ link" criteria were
// both wrong -- a long main tweet renders smaller than a short reply, and
// the main tweet's article does carry /status/ links (its permalink, and a
// quoted tweet's).
//
// A quoted tweet's body lives in the SAME article[tabindex="-1"] as the main
// body (a role="link" block, not a nested <article>), so the focused article
// can hold >1 tweetText node. The main body is always first in DOM order.
export function pickFocusedTweet(nodes: Element[]): Element[] {
  if (nodes.length <= 1) return nodes

  // The opened tweet's <article> has tabindex="-1". During an SPA tweet
  // switch the outgoing and incoming focused articles briefly coexist
  // (adr-010-phase2-dom-readiness.md §3), so take the last in DOM order.
  const focusedArticles = nodes
    .map(n => n.closest('article'))
    .filter((a): a is HTMLElement => a?.getAttribute('tabindex') === '-1')
  const focusedArticle = focusedArticles[focusedArticles.length - 1]

  if (focusedArticle) {
    // A quoted tweet's body sits in the same focused article as the main body
    // (a role="link" block, not a nested <article>), so there can be >1
    // tweetText node here; the main body is first in DOM order.
    const mainBody = nodes.find(n => focusedArticle.contains(n))
    if (mainBody) return [mainBody]
  }

  // No article marked focused (unexpected layout, or X changed the DOM):
  // fall back to the first tweetText in DOM order.
  console.warn(
    `[enx] pickFocusedTweet: no article[tabindex="-1"] among ${nodes.length} ` +
      `candidates; falling back to DOM order`
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
  // 'spa' branch (auto re-run on in-page tweet switch) lands in issue #12;
  // for now X still needs a manual re-enable after switching tweets.
  contentVolatility: 'spa',
  clickBinding: 'bubble',
  showProcessingIndicator: false,
}

// Non-default adapters, checked in order.
const ADAPTERS: SiteAdapter[] = [X_ADAPTER]

export function resolveSiteAdapter(location: Location): SiteAdapter {
  return ADAPTERS.find(adapter => adapter.matches(location)) ?? DEFAULT_ADAPTER
}
