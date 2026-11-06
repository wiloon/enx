// The side panel's account fence (#236). The worker classifies a fenced
// request when it builds the response, but the panel can receive it later,
// after a signed-in account took over. The panel hears each invalidation
// and reclassifies an obsolete signed-out response as an ordinary failure.

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

type Failure = { success: boolean; error?: string; sessionExpired?: boolean }

export const supersededFailure = <R extends Failure>(response: R): R => ({
  ...response,
  error: ACCOUNT_CHANGED_MESSAGE,
  sessionExpired: false,
})

export function createPanelAccountFence() {
  let transitions = 0
  let latest: Invalidation | undefined
  return {
    record: (cause: Invalidation) => {
      transitions++
      latest = cause
    },
    // Taken when a request starts; applied to its response just before the
    // panel shows it. A signed-out response still holds unless a switch to
    // a signed-in account came after the request started and is the latest.
    capture: () => {
      const started = transitions
      return <R extends Failure>(response: R): R =>
        !response.success &&
        response.sessionExpired === true &&
        transitions !== started &&
        latest === 'switched'
          ? supersededFailure(response)
          : response
    },
  }
}
