// ADR-089: synchronous Split View partner cache for the service worker.
// open() must run inside the user gesture, so listeners read this map
// without awaiting tabs.query.

type Membership = { splitViewId: number; windowId: number }

const membership = new Map<number, Membership>()
let cacheBuilt = false
let cacheReady: Promise<void> = Promise.resolve()

export const isSplitPartnerCacheBuilt = (): boolean => cacheBuilt

export const whenSplitPartnerCacheReady = (): Promise<void> => cacheReady

export const getSplitPartner = (tabId: number): number | undefined => {
  const mine = membership.get(tabId)
  if (!mine) return undefined
  for (const [id, other] of membership) {
    if (
      id !== tabId &&
      other.splitViewId === mine.splitViewId &&
      other.windowId === mine.windowId
    ) {
      return id
    }
  }
  return undefined
}

export const applySplitPartnerTabs = (
  tabs: Array<Pick<chrome.tabs.Tab, 'id' | 'windowId' | 'splitViewId'>>
): void => {
  membership.clear()
  for (const tab of tabs) {
    if (
      tab.id === undefined ||
      tab.windowId === undefined ||
      tab.splitViewId === undefined
    ) {
      continue
    }
    membership.set(tab.id, {
      splitViewId: tab.splitViewId,
      windowId: tab.windowId,
    })
  }
  cacheBuilt = true
}

// Clears in-memory state so a test can simulate a worker restart.
export const resetSplitPartnerCache = (): void => {
  membership.clear()
  cacheBuilt = false
  cacheReady = Promise.resolve()
}

export const startSplitPartnerCache = (
  queryAllTabs: () => Promise<
    Array<Pick<chrome.tabs.Tab, 'id' | 'windowId' | 'splitViewId'>>
  > = () => chrome.tabs.query({})
): Promise<void> => {
  cacheBuilt = false
  cacheReady = Promise.resolve()
    .then(() => queryAllTabs())
    .then(tabs => {
      applySplitPartnerTabs(Array.isArray(tabs) ? tabs : [])
    })
    .catch(error => {
      console.warn('splitViewPartnerCache: tabs.query() failed:', error)
      cacheBuilt = true
    })
  return cacheReady
}

// Returns the partner before the membership change, so cleanup can still
// find the former other side (ADR-089 Decision 4).
export const updateTabSplitMembership = (
  tabId: number,
  splitViewId: number | undefined,
  windowId: number
): number | undefined => {
  const formerPartner = getSplitPartner(tabId)
  if (splitViewId === undefined) {
    membership.delete(tabId)
  } else {
    membership.set(tabId, { splitViewId, windowId })
  }
  return formerPartner
}

export const removeTabSplitMembership = (
  tabId: number
): number | undefined => {
  const formerPartner = getSplitPartner(tabId)
  membership.delete(tabId)
  return formerPartner
}

export const areInSameSplit = (a: number, b: number): boolean => {
  if (a === b) return true
  const ma = membership.get(a)
  const mb = membership.get(b)
  return (
    ma !== undefined &&
    mb !== undefined &&
    ma.splitViewId === mb.splitViewId &&
    ma.windowId === mb.windowId
  )
}
