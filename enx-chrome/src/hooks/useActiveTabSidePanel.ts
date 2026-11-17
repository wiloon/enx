import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeTabSidePanel,
  isTabSidePanelOpen,
  openActiveTabSidePanel,
  openTabSidePanel,
  panelTabIdFromUrl,
  splitPartnerTabId,
} from '@/lib/sidePanel'

// The popup's side panel button: whether the active tab displays an open
// panel (ADR-050 / ADR-089 Decision 5), and a toggle that opens or closes
// it. Open state is read once when the popup opens and then kept in sync
// through sidePanel.onOpened/onClosed. On a Split View mirror tab the
// button follows the owner's content panel, and a click closes the mirror
// (Decision 4 closes the owner) rather than re-registering ownership.
export const useActiveTabSidePanel = () => {
  const [tabId, setTabId] = useState<number>()
  const [partnerTabId, setPartnerTabId] = useState<number>()
  const [lookupReady, setLookupReady] = useState(false)
  const [open, setOpen] = useState(false)
  const tabIdRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    let alive = true
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        if (!alive || tab?.id === undefined) return
        tabIdRef.current = tab.id
        setTabId(tab.id)

        if (
          tab.splitViewId !== undefined &&
          tab.splitViewId >= 0 &&
          tab.windowId !== undefined
        ) {
          const windowTabs = await chrome.tabs.query({
            windowId: tab.windowId,
          })
          if (!alive) return
          setPartnerTabId(splitPartnerTabId(tab, windowTabs))
        }

        setLookupReady(true)

        // When the registration names another tab, this tab is a mirror:
        // the button reflects whether that owner's panel is open (ADR-089
        // Decision 5).
        let ownerTabId = tab.id
        try {
          const options = await chrome.sidePanel.getOptions({ tabId: tab.id })
          if (!alive) return
          const named = panelTabIdFromUrl(options.path)
          if (named !== undefined) ownerTabId = named
        } catch (error) {
          console.warn(
            'useActiveTabSidePanel: sidePanel.getOptions() failed:',
            error
          )
        }

        const isOpen = await isTabSidePanelOpen(ownerTabId)
        if (alive) setOpen(isOpen)
      })
      .catch(error =>
        console.warn('useActiveTabSidePanel: tabs.query() failed:', error)
      )

    const onOpened = (info: chrome.sidePanel.PanelOpenedInfo) => {
      if (info.tabId !== undefined && info.tabId === tabIdRef.current)
        setOpen(true)
    }
    const onClosed = (info: chrome.sidePanel.PanelClosedInfo) => {
      if (info.tabId !== undefined && info.tabId === tabIdRef.current)
        setOpen(false)
    }
    chrome.sidePanel.onOpened?.addListener(onOpened)
    chrome.sidePanel.onClosed?.addListener(onClosed)
    return () => {
      alive = false
      chrome.sidePanel.onOpened?.removeListener(onOpened)
      chrome.sidePanel.onClosed?.removeListener(onClosed)
    }
  }, [])

  // open() needs the click's user gesture, so with the tab already known it
  // is called before any await. A click that beats the tab lookup falls back
  // to openActiveTabSidePanel(), whose own await is fine inside the popup.
  const toggle = useCallback(async () => {
    try {
      if (tabId === undefined || !lookupReady) {
        await openActiveTabSidePanel()
        return
      }
      if (open) {
        await closeTabSidePanel(tabId)
        setOpen(false)
      } else {
        await openTabSidePanel(tabId, partnerTabId)
        setOpen(true)
      }
    } catch (error) {
      console.error('Failed to toggle side panel from popup:', error)
    }
  }, [tabId, partnerTabId, open, lookupReady])

  return { open, toggle }
}
