// adr-046: learning mode's state is shown only on the toolbar icon's badge,
// per tab -- never inside the article. This module is the pure half: which
// status a run ends in, and what the badge looks like for each status. The
// Chrome API calls live in background/badge.ts.

import {
  failureMessage,
  type EnableFailureReason,
  type EnableOutcome,
} from '@/lib/enableOutcome'

/** Why the badge shows `!`: a failed run, or (Decision 7) a granted
 *  auto-enable site visited while signed out. */
export type LearningModeErrorReason = EnableFailureReason | 'signed-out'

export type LearningModeStatus =
  | { status: 'off' }
  | { status: 'processing' }
  | { status: 'ready' }
  | { status: 'error'; reason: LearningModeErrorReason }

export interface BadgeAppearance {
  text: string
  /** Unset for `off`: an empty badge has no background to colour. */
  color?: string
  /** Hover text; null restores the manifest's default title. */
  title: string | null
}

// --color-brand is oklch(0.55 0.13 200). setBadgeBackgroundColor takes a hex
// or RGBA, not oklch(), so this is its sRGB conversion. Keep in step with
// --brand-hue in index.css by hand.
export const BADGE_BRAND_COLOR = '#00878F'
export const BADGE_PROCESSING_COLOR = '#D97706' // amber: "in progress"
export const BADGE_ERROR_COLOR = '#DC2626'

const SIGNED_OUT_TITLE = 'Sign in to use Catglish on this site.'

const errorTitle = (reason: LearningModeErrorReason): string =>
  reason === 'signed-out' ? SIGNED_OUT_TITLE : failureMessage(reason)

// Each status differs in both character and colour, so the badge reads the
// same for colour-blind users (adr-046 Considered Options).
export function badgeFor(status: LearningModeStatus): BadgeAppearance {
  switch (status.status) {
    case 'off':
      return { text: '', title: null }
    case 'processing':
      return {
        text: '…',
        color: BADGE_PROCESSING_COLOR,
        title: 'Catglish: preparing this article…',
      }
    case 'ready':
      return {
        text: '✓',
        color: BADGE_BRAND_COLOR,
        title: 'Catglish is on. Click any word to look it up.',
      }
    case 'error':
      return {
        text: '!',
        color: BADGE_ERROR_COLOR,
        title: errorTitle(status.reason),
      }
  }
}

// Failures the user can act on (sign in again, check the network, retry).
// The rest -- a home page, a layout we don't know, nothing English -- leave
// the badge empty; a manual enable already explains them in the popup.
const ACTIONABLE: ReadonlySet<EnableFailureReason> = new Set([
  'lookup-failed',
  'session-expired',
  'error',
])

export function statusForOutcome(outcome: EnableOutcome): LearningModeStatus {
  if (outcome.ok) return { status: 'ready' }
  return ACTIONABLE.has(outcome.reason)
    ? { status: 'error', reason: outcome.reason }
    : { status: 'off' }
}

// Wraps one processing run with its status reports (adr-046 Decision 3).
// `run` calls `onArticleFound` once it has non-empty article nodes -- pages
// that fail before that never flash `processing`. A run superseded by a newer
// one (SPA tweet switch) reports nothing after it lost.
export async function runWithStatus(
  run: (onArticleFound: () => void) => Promise<EnableOutcome>,
  report: (status: LearningModeStatus) => void,
  isCurrent: () => boolean = () => true
): Promise<EnableOutcome> {
  let outcome: EnableOutcome
  try {
    outcome = await run(() => {
      if (isCurrent()) report({ status: 'processing' })
    })
  } catch (error) {
    if (isCurrent()) report({ status: 'error', reason: 'error' })
    throw error
  }
  if (isCurrent()) report(statusForOutcome(outcome))
  return outcome
}
