// ADR-095 Decision 2: who may use learning mode, and how. A browser that has
// never signed in looks words up anonymously; one that has signed in before
// keeps today's signed-out behaviour (session expired, signed out), because
// a false session loss must not drop a real user into anonymous mode.

export type LearningAccess = 'signed-in' | 'signed-out' | 'anonymous'

// What the worker's Clerk sync found: a session, none, or the check failed.
export type SessionState = 'present' | 'absent' | 'unknown'

export const learningAccessFor = (
  session: SessionState,
  everSignedIn: boolean
): LearningAccess =>
  session === 'present'
    ? 'signed-in'
    : everSignedIn
      ? 'signed-out'
      : 'anonymous'

// Every enable entry point refuses only the signed-out mode.
export const mayTurnOnLearningMode = (access: LearningAccess): boolean =>
  access !== 'signed-out'

// ADR-095 Decision 1: sentence, phrase and hover translation need an account.
// Anonymous mode shows Sign in in place and never opens the Side Panel.
export const mayOpenAccountSidePanel = (access: LearningAccess): boolean =>
  access === 'signed-in'

// The popup's "Read with Catglish" sits above the sign-in card only while
// anonymous; a browser that has signed in before keeps today's signed-out
// popup (sign-in card alone).
export const showsPopupLearningCardWhenSignedOut = (
  access: LearningAccess
): boolean => access === 'anonymous'

export interface KeyValueStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

// Stored the first time a sign-in succeeds; sign-out never clears it.
export const EVER_SIGNED_IN_KEY = 'enx-ever-signed-in'

export interface EverSignedIn {
  isSet: () => Promise<boolean>
  mark: () => Promise<void>
}

export const createEverSignedIn = (storage: KeyValueStorage): EverSignedIn => {
  let known: boolean | undefined
  return {
    isSet: async () => {
      if (known === undefined) {
        const stored = (await storage.get(EVER_SIGNED_IN_KEY)) === true
        // A mark() that finished meanwhile wins over the older read.
        known ??= stored
      }
      return known
    },
    mark: async () => {
      if (known === true) return
      known = true
      await storage.set(EVER_SIGNED_IN_KEY, true)
    },
  }
}

export interface LearningAccessDeps {
  everSignedIn: EverSignedIn
  sessionState: () => Promise<SessionState>
  // The worker's Clerk generation: it changes with the cookies or a reset.
  generation: () => number
}

// Without the flag, a signed-out answer is kept for the Clerk generation it
// was found in, so an anonymous lookup does not wait for the lost-session
// retry on every check; a cookie change starts a new generation.
export const createLearningAccess = (deps: LearningAccessDeps) => {
  let anonymousGeneration: number | undefined

  // `confirmed`: the session is known to be absent, not just unchecked.
  const check = async (): Promise<{
    access: LearningAccess
    confirmed: boolean
  }> => {
    if (
      anonymousGeneration === deps.generation() &&
      !(await deps.everSignedIn.isSet())
    ) {
      return { access: 'anonymous', confirmed: true }
    }
    const asked = deps.generation()
    const session = await deps.sessionState()
    const access = learningAccessFor(session, await deps.everSignedIn.isSet())
    const confirmed = access === 'anonymous' && session === 'absent'
    if (confirmed) {
      if (asked === deps.generation()) anonymousGeneration = asked
    } else {
      anonymousGeneration = undefined
    }
    return { access, confirmed }
  }

  return {
    current: async (): Promise<LearningAccess> => (await check()).access,
    // Only a confirmed absent session: a failed check keeps today's
    // "couldn't reach the sign-in service". With the flag set this needs no
    // session check at all.
    isAnonymous: async (): Promise<boolean> =>
      !(await deps.everSignedIn.isSet()) && (await check()).confirmed,
  }
}

// ADR-095 Decision 4: a random UUID made on first need, kept in
// chrome.storage.local, sent only on anonymous lookups.
export const ANONYMOUS_DEVICE_ID_KEY = 'enx-anonymous-device-id'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createAnonymousDeviceId = (
  storage: KeyValueStorage,
  randomUUID: () => string = () => crypto.randomUUID()
): (() => Promise<string>) => {
  let pending: Promise<string> | undefined
  return () => {
    pending ??= (async () => {
      const stored = await storage.get(ANONYMOUS_DEVICE_ID_KEY)
      if (typeof stored === 'string' && UUID_PATTERN.test(stored)) return stored
      const id = randomUUID()
      await storage.set(ANONYMOUS_DEVICE_ID_KEY, id)
      return id
    })().catch(error => {
      pending = undefined
      throw error
    })
    return pending
  }
}
