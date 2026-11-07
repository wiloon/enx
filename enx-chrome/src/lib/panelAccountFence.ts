// The side panel's account fence (#236). The worker classifies a fenced
// request when it builds the response, but the panel can receive it later,
// after a signed-in account took over. The panel hears each invalidation
// and reclassifies an obsolete signed-out or unverified (#686) response as
// an ordinary failure.

import type { Invalidation } from '@/lib/accountSession'

// What the worker tells extension pages each time the account generation
// advances.
export interface AccountInvalidatedMessage {
  action: 'accountInvalidated'
  cause: Invalidation
}

export const isAccountInvalidatedMessage = (
  message: unknown
): message is AccountInvalidatedMessage =>
  (message as { action?: unknown } | null)?.action === 'accountInvalidated'

export const ACCOUNT_CHANGED_MESSAGE =
  'Your sign-in changed while this was loading. Please try again.'

type Failure = {
  success: boolean
  error?: string
  sessionExpired?: boolean
  sessionUnverified?: boolean
  // The worker's account generation an unverified response belongs to.
  accountGeneration?: number
}

// A signed-out or unverified failure: the ones an account switch supersedes.
export const isSessionFailure = (response: Failure): boolean =>
  !response.success &&
  (response.sessionExpired === true || response.sessionUnverified === true)

export const supersededFailure = <R extends Failure>(response: R): R => ({
  ...response,
  error: ACCOUNT_CHANGED_MESSAGE,
  sessionExpired: false,
  ...(response.sessionUnverified && { sessionUnverified: false }),
})

// What the panel asks the worker when a session failure is delivered: the
// worker's fence advances before its notification can reach the panel.
export interface PanelAccountFreshness {
  sessionLost: boolean
  accountGeneration: number
}

// A signed-out response is obsolete once the worker holds a session again.
// An unverified one is obsolete once the worker switched to another signed-in
// account since classifying it; for the same account it stays unverified.
export const freshAtDelivery = <R extends Failure>(
  response: R,
  freshness: PanelAccountFreshness | undefined
): R => {
  if (response.success || !freshness) return response
  if (response.sessionExpired === true) {
    return freshness.sessionLost === false
      ? supersededFailure(response)
      : response
  }
  if (response.sessionUnverified === true) {
    return !freshness.sessionLost &&
      freshness.accountGeneration !== response.accountGeneration
      ? supersededFailure(response)
      : response
  }
  return response
}

export function createPanelAccountFence() {
  let transitions = 0
  let latest: Invalidation | undefined
  return {
    record: (cause: Invalidation) => {
      transitions++
      latest = cause
    },
    // Taken when a request starts; applied to its response just before the
    // panel shows it. A signed-out or unverified response still holds unless
    // a switch to a signed-in account came after the request started and is
    // the latest.
    capture: () => {
      const started = transitions
      return <R extends Failure>(response: R): R =>
        isSessionFailure(response) &&
        transitions !== started &&
        latest === 'switched'
          ? supersededFailure(response)
          : response
    },
  }
}
