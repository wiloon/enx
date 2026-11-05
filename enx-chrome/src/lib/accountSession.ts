// Account-owned page state can be reused only while the external auth
// identity stays the same. The saved identity survives a worker restart.
export interface AccountSessionDeps {
  readOwner: () => Promise<string | null | undefined>
  writeOwner: (owner: string | null) => Promise<void>
  invalidate: (expired: boolean) => Promise<void>
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
  }
}

export function createAccountSession(deps: AccountSessionDeps) {
  const scope = createAccountScope()
  let owner: string | null | undefined
  let initialized = false
  let pending: Promise<void> = Promise.resolve()

  const observe = (next: string | null): Promise<void> => {
    const run = pending.then(async () => {
      if (!initialized) {
        owner = await deps.readOwner()
        initialized = true
      }
      if (owner === next) return
      const changed = owner !== undefined
      if (changed) scope.clear()
      owner = next
      await deps.writeOwner(next)
      if (changed) await deps.invalidate(false)
    })
    pending = run.catch(() => {})
    return run
  }
  const clear = (expired = false): Promise<void> => {
    // Fence responses immediately, including while storage or tab messaging
    // is still pending. Clearing an already signed-out owner is intentional.
    scope.clear()
    const run = pending.then(async () => {
      owner = null
      initialized = true
      await deps.writeOwner(null)
      await deps.invalidate(expired)
    })
    pending = run.catch(() => {})
    return run
  }
  return { observe, clear, capture: scope.capture }
}
