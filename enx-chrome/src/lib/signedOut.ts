// A lost session (#236) is shown only on surfaces the extension owns: the
// badge, the side panel's row for the failed request, and an open word
// popup. Each shows the signed-out state with Sign in, never a page notice.

import type { createStore } from 'jotai'
import {
  aiLookupAtom,
  aiNoticeAtom,
  currentWordAtom,
  errorAtom,
  errorNeedsReloadAtom,
  isTranslatingAtom,
  signedOutAtom,
} from '@/store/atoms'
import { failureMessage } from '@/lib/enableOutcome'
import type { LearningModeStatus } from '@/lib/learningModeStatus'

type Store = ReturnType<typeof createStore>

export const SIGNED_OUT_MESSAGE = failureMessage('session-expired')

// A request enx-api refused even with a freshly minted token while Clerk
// still holds the session (#686): only that request failed.
export const SESSION_UNVERIFIED_MESSAGE =
  "We couldn't verify your sign-in. Try again, or sign in again."

// How the background said the session ended: a confirmed 401, or a sign-out
// it observed (on enx-ui, an expiry, or a false empty read).
export type SessionLossCause = 'expired' | 'signed-out'

// A failed request whose session ended gets Sign in; any other failure keeps
// its own message and Retry.
export const isSignedOutFailure = (response: {
  success: boolean
  sessionExpired?: boolean
}): boolean => !response.success && response.sessionExpired === true

// Replaces the open popup's account-owned contents with the signed-out state.
export const showSignedOut = (store: Store): void => {
  store.set(currentWordAtom, null)
  store.set(isTranslatingAtom, false)
  store.set(errorAtom, null)
  store.set(errorNeedsReloadAtom, false)
  store.set(aiLookupAtom, { status: 'idle' })
  store.set(aiNoticeAtom, { show: false, offerStop: false })
  store.set(signedOutAtom, true)
}

// The badge after learning mode stops for a lost session: a confirmed 401
// keeps the "!", an observed sign-out goes quietly off.
export const statusAfterSessionLoss = (
  cause: SessionLossCause
): LearningModeStatus =>
  cause === 'signed-out'
    ? { status: 'off' }
    : { status: 'error', reason: 'session-expired' }
