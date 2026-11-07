// Account-owned page state can be reused only while the external auth
// identity stays the same. The saved identity survives a worker restart.

// Why the account generation last advanced (#236): a confirmed 401
// ('expired'), a signed-in user observed as signed out ('lost'), the popup's
// own sign-out ('signed-out'), or a switch to a signed-in account
// ('switched'). Only a switch leaves a session behind.
export type Invalidation = 'expired' | 'lost' | 'signed-out' | 'switched'

export interface AccountSessionDeps {
  readOwner: () => Promise<string | null | undefined>
  writeOwner: (owner: string | null) => Promise<void>
  invalidate: (cause: Invalidation) => Promise<void>
}

export function createAccountScope() {
  let generation = 0
  return {
    clear: () => {
      generation++
    },
    capture: () => {
      const requested = generation
      return () => requested === generation
    },
    generation: () => generation,
  }
}

export function createAccountSession(deps: AccountSessionDeps) {
  const scope = createAccountScope()
  let owner: string | null | undefined
  let initialized = false
  let pending: Promise<void> = Promise.resolve()
  let lastInvalidation: Invalidation | undefined

  // The cause is recorded with the fence, so a request fenced by it is
  // classified by that cause until a later transition supersedes it.
  const fence = (cause: Invalidation) => {
    scope.clear()
    lastInvalidation = cause
  }

  const observe = (next: string | null): Promise<void> => {
    const run = pending.then(async () => {
      if (!initialized) {
        owner = await deps.readOwner()
        initialized = true
      }
      if (owner === next) return
      const cause: Invalidation | undefined =
        owner === undefined ? undefined : next === null ? 'lost' : 'switched'
      if (cause) fence(cause)
      owner = next
      await deps.writeOwner(next)
      if (cause) await deps.invalidate(cause)
    })
    pending = run.catch(() => {})
    return run
  }
  const clear = (cause: 'expired' | 'signed-out'): Promise<void> => {
    // Fence responses immediately, including while storage or tab messaging
    // is still pending. Clearing an already signed-out owner is intentional.
    fence(cause)
    const run = pending.then(async () => {
      owner = null
      initialized = true
      await deps.writeOwner(null)
      await deps.invalidate(cause)
    })
    pending = run.catch(() => {})
    return run
  }
  // Whether a request the latest fence stopped lost its session.
  const sessionLost = () =>
    lastInvalidation !== undefined && lastInvalidation !== 'switched'
  return {
    observe,
    clear,
    capture: scope.capture,
    generation: scope.generation,
    sessionLost,
  }
}
