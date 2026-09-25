// What happened when learning mode tried to process a page. Until now
// processArticleContent() returned a bare boolean, so "no article node",
// "no English words", "the backend returned nothing" and "session expired"
// were indistinguishable -- the popup even showed "completed" for all of
// them. A typed outcome lets the popup say something useful and lets us
// notice which pages we cannot handle.

export type EnableFailureReason =
  /** The adapter matched the host but declared this page out of scope. */
  | 'unsupported-page'
  /** The content selector matched nothing: a page layout we don't know. */
  | 'no-article-node'
  /** Content was found but held no English words. */
  | 'no-words'
  /** The word backend returned no data for the page. */
  | 'lookup-failed'
  /** The sign-in session expired (the page already shows its own notice). */
  | 'session-expired'
  /** An unexpected exception. */
  | 'error'
  /** The browser refused to run our script on this page (chrome://, the
   *  Web Store, etc.) -- adr-034: on-demand injection can't help here, and
   *  never will, so it isn't a page-structure problem worth reporting. */
  | 'injection-blocked'

export type EnableOutcome =
  { ok: true } | { ok: false; reason: EnableFailureReason }

// Not failures: a newer run took over (SPA navigation) or the same run was
// re-triggered. These are reported as ok:true upstream and never surface.

export const ENABLE_OK: EnableOutcome = { ok: true }

export const failed = (reason: EnableFailureReason): EnableOutcome => ({
  ok: false,
  reason,
})

// The popup's error line for each failure. English UI copy (AGENTS.md).
const FAILURE_MESSAGES: Record<EnableFailureReason, string> = {
  'unsupported-page': 'Catglish does not support this page yet.',
  'no-article-node':
    "Catglish couldn't find any readable text on this page. This page layout isn't supported yet.",
  'no-words': 'No English words to highlight were found on this page.',
  'lookup-failed':
    "Catglish couldn't load word data for this page. Check your connection and try again.",
  'session-expired': 'Your session has expired. Please sign in again.',
  error: 'Something went wrong while processing this page.',
  'injection-blocked': "Catglish can't run on this page.",
}

export const failureMessage = (reason: EnableFailureReason): string =>
  FAILURE_MESSAGES[reason]

// Failures worth telling us about. 'unsupported-page' is a deliberate gate
// (a user on an X timeline), 'session-expired' is the user's own state and
// 'lookup-failed' is usually the network -- none of them say "this page's
// layout defeated us". A layout we can't parse, or an exception, do.
const REPORTABLE: ReadonlySet<EnableFailureReason> = new Set([
  'no-article-node',
  'no-words',
  'error',
])

export const isReportableFailure = (reason: EnableFailureReason): boolean =>
  REPORTABLE.has(reason)
