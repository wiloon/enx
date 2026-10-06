// adr-039 Decision 4: on a site the user chose "Always enable on this site"
// for, turn learning mode on at page load. Unlike the popup button, every
// failure here is silent -- the same origin has home and list pages with no
// article, and nobody asked for an error on those. On an SPA site learning
// mode stays armed after such a failure so the next in-page navigation can
// still pick an article up (adr-033).

import type { EnableOutcome } from '@/lib/enableOutcome'

export interface AutoEnableDeps {
  /** Asks the background whether this site is granted (and signed in). */
  askBackground: () => Promise<boolean>
  /** The site adapter's pageSupport check (e.g. an X timeline is out of scope). */
  isPageSupported: () => boolean
  /** The same enable path the popup's enxRun uses. */
  enable: () => Promise<EnableOutcome>
  /** Tear learning mode back down, leaving the page as it was. */
  disable: () => void
  /**
   * True on an SPA site, where enabling also listens for in-page navigations
   * and re-runs on each one (ADR-011 Decision 6). There a failed first run --
   * no article open yet -- is not the end: the next navigation may bring one.
   */
  keepsWatching: () => boolean
}

// A signed-out session fails every later run the same way, so it is the one
// failure an SPA site still rolls back on.
const shouldRollBack = (
  outcome: EnableOutcome & { ok: false },
  keepsWatching: boolean
): boolean => !keepsWatching || outcome.reason === 'session-expired'

export async function maybeAutoEnable(deps: AutoEnableDeps): Promise<void> {
  let granted = false
  try {
    granted = await deps.askBackground()
  } catch (error) {
    console.debug('auto-enable: background unreachable', error)
    return
  }
  if (!granted || !deps.isPageSupported()) return

  try {
    const outcome = await deps.enable()
    if (!outcome.ok) {
      if (shouldRollBack(outcome, deps.keepsWatching())) {
        console.debug(`auto-enable: rolled back (${outcome.reason})`)
        deps.disable()
      } else {
        console.debug(
          `auto-enable: ${outcome.reason}; waiting for the next navigation`
        )
      }
    }
  } catch (error) {
    console.debug('auto-enable: rolled back after an error', error)
    deps.disable()
  }
}
