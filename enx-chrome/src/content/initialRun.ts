// The first processing run after learning mode turns on (popup enxRun or
// adr-039 auto-enable). Any adapter with a readySelector renders its content
// after document_end on some pages -- an SPA (X, RSSX), or a static page
// that fills its article column by script (AWS docs) -- so the run waits for
// it first, as an SPA navigation does (ADR-011 Decision 6.2). Static
// adapters get no route-change listener; only this one wait.

import { ENABLE_OK, type EnableOutcome } from '@/lib/enableOutcome'
import type { SiteAdapter } from '@/lib/siteAdapters'
import { waitForContentReady } from './spaRebuild'

// Longer than an in-page switch: on RSSX the open Article only renders after
// the feed list, the feed and the article itself have been fetched.
export const INITIAL_READY_TIMEOUT_MS = 8000

export interface InitialRunDeps {
  adapter: Pick<SiteAdapter, 'readySelector'>
  /**
   * False once the run is superseded: learning mode turned off or re-run,
   * the script stood down, or (SPA) a newer navigation.
   */
  isCurrent: () => boolean
  /** Article detection and processing; not started for a cancelled run. */
  process: () => Promise<EnableOutcome>
}

export interface InitialRunner {
  /** Wait for the adapter's readySelector, then process. Supersedes a pending run. */
  run: (deps: InitialRunDeps) => Promise<EnableOutcome>
  /**
   * Ends a pending wait now, releasing its observer and timers: called when
   * learning mode turns off and on every SPA navigation.
   */
  cancel: () => void
}

export function createInitialRunner(): InitialRunner {
  let pending: AbortController | null = null

  const cancel = () => {
    pending?.abort()
    pending = null
  }

  const run = async (deps: InitialRunDeps): Promise<EnableOutcome> => {
    cancel()
    const controller = new AbortController()
    pending = controller
    const isCurrent = () => !controller.signal.aborted && deps.isCurrent()
    await waitForContentReady(
      deps.adapter.readySelector,
      isCurrent,
      INITIAL_READY_TIMEOUT_MS,
      controller.signal
    )
    if (pending === controller) pending = null
    // A superseded run is not a failure: the popup shows nothing for it.
    if (!isCurrent()) return ENABLE_OK
    return deps.process()
  }

  return { run, cancel }
}
