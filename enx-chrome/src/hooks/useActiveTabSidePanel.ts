import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeTabSidePanel,
  isTabSidePanelOpen,
  openActiveTabSidePanel,
  openTabSidePanel,
} from '@/lib/sidePanel'

// The popup's side panel button: whether the active tab's own panel (ADR-050)
// is open, and a toggle that opens or closes it. The state is read once when
// the popup opens and then kept in sync through sidePanel.onOpened/onClosed,
// so a panel opened or closed elsewhere (context menu, the panel's own X)
// flips the button too.
export const useActiveTabSidePanel = () => {
  const [tabId, setTabId] = useState<number>()
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
        const isOpen = await isTabSidePanelOpen(tab.id)
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
      if (tabId === undefined) {
        await openActiveTabSidePanel()
        return
      }
      if (open) {
        await closeTabSidePanel(tabId)
        setOpen(false)
      } else {
        await openTabSidePanel(tabId)
        setOpen(true)
      }
    } catch (error) {
      console.error('Failed to toggle side panel from popup:', error)
    }
  }, [tabId, open])

  return { open, toggle }
}
