// ADR-011 Decision 6: on a `contentVolatility: 'spa'` site (X), an in-page
// navigation swaps the whole content subtree without re-injecting the
// content script. This module owns the automatic teardown + rebuild on
// every route change so learning mode survives switching tweets without a
// manual re-enable.
//
// The orchestration (`createSpaRebuilder`) is pure -- every DOM / adapter /
// network touch is an injected dependency -- and the concrete X
// implementations of those deps (`isSupportedPage`, `waitForTweetReady`)
// and the navigate filter (`shouldHandleTweetNavigate`) sit beside it, each
// unit-testable.

import { resolveSiteAdapter } from '@/lib/siteAdapters'

export interface SpaRebuilderDeps {
  /** Is the destination URL still a supported page for this adapter? */
  isPageSupported: (url: string) => boolean
  /**
   * Resolves once the new content's DOM has settled (or a timeout). Passed
   * `isCurrent` so it can bail early if a newer route change has landed.
   */
  waitForContentReady: (isCurrent: () => boolean) => Promise<void>
  /** Drop the current highlights + popup immediately. */
  teardown: () => void
  /**
   * Full processing pass + highlight rebuild over the new content. Passed
   * `isCurrent` so it can abandon at its own await boundaries.
   */
  rebuild: (isCurrent: () => boolean) => Promise<void>
}

/** The slice of the Navigation API this module uses (Chrome 102+). */
export interface NavigationLike {
  addEventListener(type: 'navigate', listener: (event: NavigateEvent) => void): void
  removeEventListener(
    type: 'navigate',
    listener: (event: NavigateEvent) => void
  ): void
}

export interface SpaRebuilder {
  /**
   * Handle a route change to `url`. Navigation-type agnostic -- `push`
   * (clicking a tweet) and `traverse` (browser back) both just carry a URL.
   */
  onRouteChange: (url: string) => Promise<void>
  /**
   * A cancellation check bound to the generation counter as it stands now,
   * for the initial (non-navigate) processing run so it too is abandoned
   * when the user switches tweets mid-flight.
   */
  makeIsCurrent: () => () => boolean
  /** Subscribe to `navigation` 'navigate' events (filtered). Idempotent. */
  start: (navigation: NavigationLike) => void
  /** Unsubscribe. Idempotent. */
  stop: () => void
}

// A `navigate` event worth reacting to: an actual in-page location change,
// not a download, a same-document hash change, or a full reload (a reload
// re-injects the content script anyway).
export function shouldHandleTweetNavigate(event: NavigateEvent): boolean {
  return (
    event.downloadRequest === null &&
    !event.hashChange &&
    event.navigationType !== 'reload'
  )
}

// Is `url` still a supported page for whatever adapter matches it? Used to
// stop silently when the user navigates off a tweet (to a profile, the home
// timeline). Returns true for any URL the default adapter matches.
export function isSupportedPage(url: string): boolean {
  try {
    const loc = new URL(url)
    const adapter = resolveSiteAdapter(loc)
    return !adapter.pageSupport || adapter.pageSupport(loc) == null
  } catch {
    return false
  }
}

const TWEET_READY_SELECTOR = 'article[tabindex="-1"] [data-testid="tweetText"]'
const TWEET_READY_DEBOUNCE_MS = 100
const TWEET_READY_TIMEOUT_MS = 2000

// Resolves once the new tweet's text has settled: the readiness selector
// matches with non-empty text and then stays quiet for the debounce window
// (ADR-011 Decision 6.2 -- adr-010-phase2-dom-readiness.md settled that
// article[tabindex="-1"] is the only reliable signal; never document.title
// or aria-live, and take the last match during the ~750ms handoff). Always
// resolves, never rejects: a 2s timeout falls through to a best-effort
// rebuild.
export function waitForTweetReady(isCurrent: () => boolean): Promise<void> {
  return new Promise<void>(resolve => {
    let debounce: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      observer.disconnect()
      clearTimeout(debounce)
      clearTimeout(timeout)
      resolve()
    }
    const check = () => {
      if (!isCurrent()) return finish()
      const matches = document.querySelectorAll(TWEET_READY_SELECTOR)
      const last = matches[matches.length - 1]
      if (last && (last.textContent || '').trim().length > 0) {
        clearTimeout(debounce)
        debounce = setTimeout(finish, TWEET_READY_DEBOUNCE_MS)
      }
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    const timeout = setTimeout(finish, TWEET_READY_TIMEOUT_MS)
    check() // maybe already ready
  })
}

export function createSpaRebuilder(deps: SpaRebuilderDeps): SpaRebuilder {
  // Bumped on every route change; a run whose captured value no longer
  // matches has been superseded and abandons. Rapid tweet-switching thus
  // completes only the last.
  let gen = 0

  const onRouteChange = async (url: string): Promise<void> => {
    const myGen = ++gen
    const isCurrent = () => myGen === gen

    // Every navigate: tear down first, unconditionally.
    deps.teardown()

    // Navigated off a supported page (profile, home timeline): stop in the
    // torn-down state, silently. Surfacing "not a tweet page" is the manual
    // enxRun path's job, not this one.
    if (!deps.isPageSupported(url)) return

    await deps.waitForContentReady(isCurrent)
    if (!isCurrent()) return

    await deps.rebuild(isCurrent)
  }

  const makeIsCurrent = () => {
    const g = gen
    return () => g === gen
  }

  let subscribed: NavigationLike | null = null
  let listener: ((event: NavigateEvent) => void) | null = null

  const start = (navigation: NavigationLike) => {
    if (listener) return
    subscribed = navigation
    listener = event => {
      if (shouldHandleTweetNavigate(event)) {
        void onRouteChange(event.destination.url)
      }
    }
    navigation.addEventListener('navigate', listener)
  }

  const stop = () => {
    if (subscribed && listener) {
      subscribed.removeEventListener('navigate', listener)
    }
    subscribed = null
    listener = null
  }

  return { onRouteChange, makeIsCurrent, start, stop }
}
