// Turns a burst of change signals into as few runs of one sync as it can
// (#743). A sign-in rewrites Clerk's session cookies several times in a row;
// running the session sync once per cookie change loads the Clerk client
// dozens of times and gets rate-limited.
//
// - The first change of a burst starts a trailing quiet timer; each further
//   change restarts it, but the run starts no later than `maxWaitMs` after
//   the first change.
// - Changes during a run do not restart it: the run is superseded, its
//   result is dropped, and one follow-up run starts as soon as it settles.
// - Every caller of `change()` gets the outcome of the newest run that no
//   later change superseded.

export interface CoalescedSyncOptions<T> {
  run: () => Promise<T>
  quietMs: number
  maxWaitMs: number
}

export interface CoalescedSync<T> {
  change: () => Promise<T>
  settleNow: (value: T | PromiseLike<T>) => boolean
  // The outcome a change still waits for, or null once it has settled.
  pending: () => Promise<T> | null
}

type Waiters<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (error: unknown) => void
}

const waiters = <T>(): Waiters<T> => {
  let resolve: (value: T | PromiseLike<T>) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

export function createCoalescedSync<T>({
  run,
  quietMs,
  maxWaitMs,
}: CoalescedSyncOptions<T>): CoalescedSync<T> {
  let waiting: Waiters<T> | null = null
  let quietTimer: ReturnType<typeof setTimeout> | undefined
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let superseded = false

  const settle = (outcome: { value: T } | { error: unknown }) => {
    running = false
    if (superseded) {
      start()
      return
    }
    const settled = waiting!
    waiting = null
    if ('error' in outcome) settled.reject(outcome.error)
    else settled.resolve(outcome.value)
  }

  const start = () => {
    clearTimeout(quietTimer)
    clearTimeout(maxWaitTimer)
    quietTimer = maxWaitTimer = undefined
    running = true
    superseded = false
    let current: Promise<T>
    try {
      current = run()
    } catch (error) {
      current = Promise.reject(error)
    }
    current.then(
      value => settle({ value }),
      error => settle({ error })
    )
  }

  const change = () => {
    if (!waiting) waiting = waiters<T>()
    if (running) {
      superseded = true
    } else {
      clearTimeout(quietTimer)
      quietTimer = setTimeout(start, quietMs)
      maxWaitTimer ??= setTimeout(start, maxWaitMs)
    }
    return waiting.promise
  }

  // Ends an open burst with `value` and no run, when none is in progress:
  // the caller knows the burst changed nothing. Returns false mid-run.
  const settleNow = (value: T | PromiseLike<T>): boolean => {
    if (running) return false
    clearTimeout(quietTimer)
    clearTimeout(maxWaitTimer)
    quietTimer = maxWaitTimer = undefined
    const settled = waiting
    waiting = null
    settled?.resolve(value)
    return true
  }

  return { change, settleNow, pending: () => waiting?.promise ?? null }
}
