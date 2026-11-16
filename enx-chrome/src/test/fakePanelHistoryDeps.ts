// In-memory fakes for panelHistoryStore unit tests (ADR-090): shared
// storage.session, a serialising lock manager, and a controllable tab map.

import type {
  PanelHistoryStoreDeps,
  StoredPanelHistory,
} from '@/lib/panelHistoryStore'

type LockWaiter = {
  resolve: () => void
}

export function createFakePanelHistoryDeps(options?: {
  tabExists?: (tabId: number) => boolean | Promise<boolean>
  now?: () => number
  rejectSetTimes?: number
}): PanelHistoryStoreDeps & {
  bag: Record<string, StoredPanelHistory>
  setRejectRemaining: number
  heldLocks: Set<string>
} {
  const bag: Record<string, StoredPanelHistory> = {}
  const queues = new Map<string, LockWaiter[]>()
  const held = new Set<string>()
  let setRejectRemaining = options?.rejectSetTimes ?? 0

  const requestLock: PanelHistoryStoreDeps['requestLock'] = async (
    name,
    callback
  ) => {
    if (held.has(name)) {
      await new Promise<void>(resolve => {
        const q = queues.get(name) ?? []
        q.push({ resolve })
        queues.set(name, q)
      })
    }
    held.add(name)
    try {
      return await callback()
    } finally {
      held.delete(name)
      const next = queues.get(name)?.shift()
      next?.resolve()
    }
  }

  return {
    bag,
    heldLocks: held,
    get setRejectRemaining() {
      return setRejectRemaining
    },
    set setRejectRemaining(n: number) {
      setRejectRemaining = n
    },
    storage: {
      get: async key => bag[key],
      set: async (key, value) => {
        if (setRejectRemaining > 0) {
          setRejectRemaining--
          throw new Error('QUOTA_BYTES quota exceeded')
        }
        bag[key] = JSON.parse(JSON.stringify(value)) as StoredPanelHistory
      },
      remove: async key => {
        delete bag[key]
      },
    },
    requestLock,
    tabExists: async tabId => {
      if (options?.tabExists) return options.tabExists(tabId)
      return true
    },
    now: options?.now ?? (() => Date.now()),
  }
}
