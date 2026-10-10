// ADR-050: the Side Panel is always a tab-specific panel. It belongs to the
// tab it was opened for -- hidden when the user switches away, destroyed when
// that tab closes -- and there is no window-wide (global) panel at all.

const PENDING_SENTENCE_KEY_PREFIX = 'enx-pending-sentence'
const LATEST_PAGE_WORD_KEY_PREFIX = 'enx-latest-page-word'

// The panel learns which tab it belongs to from its own URL, written by
// whoever opened it, rather than guessing from the active tab at mount time
// (the user may already have switched away).
export const sidePanelPath = (tabId: number): string =>
  `sidepanel.html?tabId=${tabId}`

export const panelTabIdFromUrl = (url?: string): number | undefined => {
  if (!url) return undefined
  const query = url.includes('?') ? url.slice(url.indexOf('?')) : ''
  const raw = new URLSearchParams(query).get('tabId')
  if (!raw || !/^\d+$/.test(raw)) return undefined
  return Number(raw)
}

// chrome.storage.session keys holding what a tab's panel should show. Keyed
// by tab so one tab's "整句翻译" click never refreshes another tab's panel.
// Shared helpers so background.ts (writer) and SidePanel.tsx (reader) can't
// drift apart on the key format.
export const pendingSentenceKey = (tabId: number): string =>
  `${PENDING_SENTENCE_KEY_PREFIX}:${tabId}`

export const latestPageWordKey = (tabId: number): string =>
  `${LATEST_PAGE_WORD_KEY_PREFIX}:${tabId}`

// Registers the tab's own panel, then opens it. open() only works inside a
// user gesture and any `await` before it spends that gesture, so setOptions()
// is deliberately not awaited: Chrome handles the two calls in order. The
// returned promise is open()'s, so a caller can fall back when Chrome refuses.
export const openTabSidePanel = (tabId: number): Promise<void> => {
  chrome.sidePanel
    .setOptions({ tabId, path: sidePanelPath(tabId), enabled: true })
    .catch(error =>
      console.warn('openTabSidePanel: sidePanel.setOptions() failed:', error)
    )
  return chrome.sidePanel.open({ tabId })
}

// Trigger path① (spec §3.2): the popup's button. A click inside the popup is
// a real, unforwarded user gesture, so awaiting the tab lookup first is fine
// here (it has always awaited windows.getCurrent() the same way).
export const openActiveTabSidePanel = async (): Promise<void> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined) return
  await openTabSidePanel(tab.id)
}

// Whether the given tab's own panel is open right now. Chrome has no direct
// query for this, so it looks for a live SIDE_PANEL context whose URL names
// the tab (ADR-050): another tab's open panel doesn't count. Matched in JS
// rather than passing contextTypes as a filter, since
// chrome.runtime.ContextType can be undefined at runtime.
export const isTabSidePanelOpen = async (tabId: number): Promise<boolean> => {
  try {
    const contexts = (await chrome.runtime.getContexts?.({})) ?? []
    return contexts.some(
      c =>
        c.contextType === ('SIDE_PANEL' as chrome.runtime.ContextType) &&
        panelTabIdFromUrl(c.documentUrl) === tabId
    )
  } catch (error) {
    console.warn('isTabSidePanelOpen: getContexts() failed:', error)
    return false
  }
}

// Closes the tab's own panel (Chrome 141+); a no-op when it isn't open.
// Unlike open(), close() needs no user gesture. The tab's panel stays
// registered, so openTabSidePanel() reopens it later.
export const closeTabSidePanel = (tabId: number): Promise<void> =>
  chrome.sidePanel.close({ tabId })
