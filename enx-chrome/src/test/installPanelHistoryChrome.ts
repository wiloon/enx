// Shared chrome.storage.session bag + navigator.locks mock for SidePanel
// tests under ADR-090 (history writes and the panel-alive lock).

type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
) => void

export function installPanelHistoryChrome(options?: {
  tabId?: number
  onStorageChange?: StorageChangeListener
}) {
  const tabId = options?.tabId ?? 7
  const sessionBag: Record<string, unknown> = {}
  const storageChangeListeners: StorageChangeListener[] = []
  const fireStorageChange: StorageChangeListener = (changes, areaName) => {
    storageChangeListeners.forEach(listener => listener(changes, areaName))
    options?.onStorageChange?.(changes, areaName)
  }

  ;(chrome.storage.session.get as jest.Mock).mockImplementation(
    async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys == null) return { ...sessionBag }
      if (typeof keys === 'string') {
        return keys in sessionBag ? { [keys]: sessionBag[keys] } : {}
      }
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {}
        for (const k of keys) {
          if (k in sessionBag) out[k] = sessionBag[k]
        }
        return out
      }
      const out: Record<string, unknown> = { ...keys }
      for (const k of Object.keys(keys)) {
        if (k in sessionBag) out[k] = sessionBag[k]
      }
      return out
    }
  )
  ;(chrome.storage.session.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      const changes: { [key: string]: chrome.storage.StorageChange } = {}
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: sessionBag[key], newValue: value }
        sessionBag[key] = value
      }
      fireStorageChange(changes, 'session')
    }
  )
  ;(chrome.storage.session.remove as jest.Mock).mockImplementation(
    async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys]
      const changes: { [key: string]: chrome.storage.StorageChange } = {}
      for (const key of list) {
        changes[key] = { oldValue: sessionBag[key], newValue: undefined }
        delete sessionBag[key]
      }
      fireStorageChange(changes, 'session')
    }
  )
  ;(chrome.tabs.get as jest.Mock).mockResolvedValue({ id: tabId })
  ;(chrome.storage.onChanged.addListener as jest.Mock).mockImplementation(
    (listener: StorageChangeListener) => {
      storageChangeListeners.push(listener)
    }
  )
  ;(chrome.storage.onChanged.removeListener as jest.Mock).mockImplementation(
    () => {}
  )

  const heldLocks = new Set<string>()
  const lockWaiters = new Map<string, Array<() => void>>()
  const releaseWaiter = (name: string) => {
    heldLocks.delete(name)
    const next = lockWaiters.get(name)?.shift()
    next?.()
  }
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: jest.fn(
        async (
          name: string,
          optionsOrCallback:
            { signal?: AbortSignal } | (() => Promise<unknown>),
          maybeCallback?: () => Promise<unknown>
        ) => {
          const callback =
            typeof optionsOrCallback === 'function'
              ? optionsOrCallback
              : maybeCallback!
          if (heldLocks.has(name)) {
            await new Promise<void>(resolve => {
              const q = lockWaiters.get(name) ?? []
              q.push(resolve)
              lockWaiters.set(name, q)
            })
          }
          heldLocks.add(name)
          try {
            return await callback()
          } finally {
            releaseWaiter(name)
          }
        }
      ),
    },
  })

  return {
    sessionBag,
    storageChangeListeners,
    fireStorageChange,
    seedSession: (data: Record<string, unknown>) => {
      Object.assign(sessionBag, data)
    },
  }
}
