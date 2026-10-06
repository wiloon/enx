// Per-site behavior differences that don't fit getArticleNodes()'s flat
// selector list — the text-length threshold, which matched node is the one
// to process, how volatile the content is, and whether to show the
// completion indicator (ADR-010, ADR-011 Decision 4).
//
// resolveSiteAdapter() returns DEFAULT_ADAPTER for ordinary article sites;
// its field values reproduce the original hard-coded behavior field-for-field.
// Only X, the enx-ui Reader and the RSSX Reader need their own adapter.

// The subset of a Location the adapters read. Both `window.location` and a
// `URL` (from a Navigation API destination) satisfy it.
export type PageLocation = Pick<Location, 'host' | 'hostname' | 'pathname'>

export interface SiteAdapter {
  name: string
  /** Host-level match against the page location. */
  matches: (location: PageLocation) => boolean
  /**
   * Page-level gate evaluated after `matches` succeeds. Returns a user-facing
   * string when this specific page is out of scope (e.g. an X timeline or
   * search page rather than a tweet detail page) — enxRun then aborts and
   * surfaces that message. Returns null when the page is supported. Undefined
   * means every page under the matched host is supported (today's behavior).
   */
  pageSupport?: (location: PageLocation) => string | null
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
   *   'spa'       — a Navigation API route-change listener re-runs on in-page
   *                 navigation (X switching tweets).
   *   'streaming' — incremental MutationObserver (ADR-010 Phase 3/4, not yet).
   */
  contentVolatility: 'static' | 'spa' | 'streaming'
  /**
   * 'spa' only: matches once the page's content has rendered. Learning mode
   * waits for it (non-empty, then quiet) before processing, both on the
   * initial run and after every in-page navigation (ADR-011 Decision 6.2).
   */
  readySelector?: string
  /**
   * Where the delegated click-to-lookup listener binds (ADR-011 Decision 2 /
   * ADR-010 Options F3). Defaults to 'bubble'; 'documentCapture' is a
   * placeholder, not yet implemented.
   */
  clickBinding?: 'bubble' | 'documentCapture'
}

// Field-for-field equal to today's hard-coded behavior. Every whitelisted
// article site resolves to this.
export const DEFAULT_ADAPTER: SiteAdapter = {
  name: 'default',
  matches: () => true,
  minTextLength: 100,
  contentVolatility: 'static',
}

// --- X (Twitter) -----------------------------------------------------------
// ADR-010 Phase 1: the main tweet body on a tweet-detail page only.

const X_HOST = /(^|\.)(x|twitter)\.com$/
const TWEET_DETAIL_PATH = /^\/[^/]+\/status\/\d+/

// A tweet's body, and the body of an X Article (long-form post). An Article
// lives at the same /<user>/status/<id> URL as a tweet but renders no
// tweetText node at all -- its body is one twitterArticleRichTextView block
// (verified in Chrome, 2026-09-20), inside the same article[tabindex="-1"]
// focus marker a tweet uses.
export const X_TWEET_TEXT_SELECTOR = 'div[data-testid="tweetText"]'
export const X_ARTICLE_BODY_SELECTOR =
  '[data-testid="twitterArticleRichTextView"]'
export const X_CONTENT_SELECTORS = [
  X_TWEET_TEXT_SELECTOR,
  X_ARTICLE_BODY_SELECTOR,
]
export const X_CONTENT_SELECTOR = X_CONTENT_SELECTORS.join(', ')

// adr-010-phase2-dom-readiness.md settled that article[tabindex="-1"] (the
// opened tweet) is the only reliable readiness signal -- never document.title
// or aria-live.
export const X_READY_SELECTOR = X_CONTENT_SELECTORS.map(
  selector => `article[tabindex="-1"] ${selector}`
).join(', ')

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
    // tweetText node here; the main body is first in DOM order. On an X
    // Article page the article body wins outright: replies below it are
    // tweetText nodes too, but they live in tabindex="0" articles.
    const inFocused = nodes.filter(n => focusedArticle.contains(n))
    const mainBody =
      inFocused.find(n => n.matches(X_ARTICLE_BODY_SELECTOR)) ?? inFocused[0]
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
      : 'Catglish currently supports only X tweet detail pages. Open a tweet first.',
  contentSelector: X_CONTENT_SELECTOR,
  // A tweet body caps at 280 chars and short tweets fall well under the
  // default 100; >1 still filters out pure-emoji / pure-link empty nodes.
  minTextLength: 1,
  focusedNodeResolver: pickFocusedTweet,
  contentVolatility: 'spa',
  readySelector: X_READY_SELECTOR,
  clickBinding: 'bubble',
}

// --- enx-ui Reader (ADR-019) ---------------------------------------------
// enx-ui's /reader page renders user-pasted plain text into
// #enx-reader-article; the extension treats it like a whitelisted article
// site, but only on the /reader route. The app's other pages (/lookup,
// /rephrase, /billing, ...) load the content script too (the manifest
// whitelists the whole origin) but are not meant to be read here.

// Matched against `host`, so the port counts: dev enx-ui is localhost:3000,
// and other localhost servers (e.g. the E2E fixture pages on :8765) are
// ordinary sites, not the Reader.
const ENX_UI_HOSTS = new Set([
  'localhost:3000',
  'enx.wiloon.lab',
  'enx.wiloon.com',
  'catglish.com',
])

/** True when the page is served by enx-ui (dev, homelab, or prod). */
export function isEnxUiHost(location: PageLocation): boolean {
  return ENX_UI_HOSTS.has(location.host)
}

const READER_ADAPTER: SiteAdapter = {
  name: 'reader',
  matches: isEnxUiHost,
  pageSupport: location =>
    location.pathname === '/reader' || location.pathname.startsWith('/reader/')
      ? null
      : 'Catglish only works on the Reader page here. Paste text into the Reader and submit first.',
  contentSelector: '#enx-reader-article',
  // The user may paste a single short paragraph.
  minTextLength: 1,
  contentVolatility: 'static',
  clickBinding: 'bubble',
}

// --- RSSX Reader (ADR-033) ------------------------------------------------
// A Vue SPA: picking an Article swaps the reading pane in place and rewrites
// the query string with router.replace, which the Navigation API reports as
// a navigate event. The Reader renders exactly one <article> -- the open one
// (title + Feed body) -- and only while one is open; the feed and article
// columns are <section>s. So plain semantic HTML is the whole contract.

const RSSX_HOSTS = new Set(['rssx-lab.wiloon.com'])

const RSSX_ADAPTER: SiteAdapter = {
  name: 'rssx',
  matches: location => RSSX_HOSTS.has(location.host),
  contentSelector: 'article',
  // A Feed may carry only a title and a one-line summary.
  minTextLength: 1,
  contentVolatility: 'spa',
  readySelector: 'article',
  clickBinding: 'bubble',
}

// Non-default adapters, checked in order.
const ADAPTERS: SiteAdapter[] = [X_ADAPTER, READER_ADAPTER, RSSX_ADAPTER]

export function resolveSiteAdapter(location: PageLocation): SiteAdapter {
  return ADAPTERS.find(adapter => adapter.matches(location)) ?? DEFAULT_ADAPTER
}
