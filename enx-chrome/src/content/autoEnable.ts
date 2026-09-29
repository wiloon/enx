// adr-039 Decision 4: on a site the user chose "Always enable on this site"
// for, turn learning mode on at page load. Unlike the popup button, every
// failure here is silent -- the same origin has home and list pages with no
// article, and nobody asked for an error on those.

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
}

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
      console.debug(`auto-enable: rolled back (${outcome.reason})`)
      deps.disable()
    }
  } catch (error) {
    console.debug('auto-enable: rolled back after an error', error)
    deps.disable()
  }
}
