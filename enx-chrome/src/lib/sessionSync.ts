// What a Clerk session sync proves about the session (#688). clerk-js
// resolves a load with no session, and throws nothing, when its Frontend API
// read failed while it could not see an online browser, so an empty load
// alone proves nothing. Only a read of the client that succeeded and held no
// signed-in session confirms the session is gone.

export type SessionSync = 'present' | 'absent' | 'unconfirmed'

export type SessionSyncEvidence =
  | { loaded: false }
  | {
      loaded: true
      hasSession: boolean
      // A read of Clerk's client after the load got a 2xx with no signed-in
      // session in it.
      signedOutReadSucceeded: boolean
    }

export const classifySessionSync = (
  evidence: SessionSyncEvidence
): SessionSync => {
  if (!evidence.loaded) return 'unconfirmed'
  if (evidence.hasSession) return 'present'
  return evidence.signedOutReadSucceeded ? 'absent' : 'unconfirmed'
}

// A request that got no session token never reaches enx-api. It ends the
// session only when Clerk confirmed the session is gone; otherwise it is an
// ordinary failure that leaves the account session alone.
export type NoTokenOutcome = 'session-loss' | 'transient'

export const outcomeWithoutToken = (sync: SessionSync): NoTokenOutcome =>
  sync === 'absent' ? 'session-loss' : 'transient'

export const SIGN_IN_SERVICE_UNREACHABLE_MESSAGE =
  "Couldn't reach the sign-in service. Please try again."
