// ADR-089: open / close / cleanup the mirrored Split View side panel.
// Ownership is whatever sidePanel.getOptions reports for a tab's
// path; there is no pair record in storage.

import { panelTabIdFromUrl, sidePanelPath } from '@/lib/sidePanel'
import {
  areInSameSplit,
  getSplitPartner,
  isSplitPartnerCacheBuilt,
  whenSplitPartnerCacheReady,
} from '@/lib/splitViewPartnerCache'

export const createSplitViewSidePanel = (
  sidePanel: Pick<
    typeof chrome.sidePanel,
    'setOptions' | 'open' | 'close' | 'getOptions'
  >,
  openTabSidePanel: (tabId: number, partnerTabId?: number) => Promise<void>
) => {
  // Opens the owning tab (and its cached partner when known) inside the
  // current user gesture. When the tab is in a Split View but the cache is
  // still building, opens the owner now and tries the partner once after.
  const openTabSidePanelForSplit = (
    tabId: number,
    splitViewId?: number
  ): Promise<void> => {
    const partner = getSplitPartner(tabId)
    if (partner !== undefined) {
      return openTabSidePanel(tabId, partner)
    }

    const opening = openTabSidePanel(tabId)
    if (
      splitViewId !== undefined &&
      splitViewId >= 0 &&
      !isSplitPartnerCacheBuilt()
    ) {
      void whenSplitPartnerCacheReady().then(() => {
        const laterPartner = getSplitPartner(tabId)
        if (laterPartner === undefined) return
        const path = sidePanelPath(tabId)
        sidePanel
          .setOptions({ tabId: laterPartner, path, enabled: true })
          .catch(error =>
            console.warn(
              'openTabSidePanelForSplit: cold-start partner setOptions failed:',
              error
            )
          )
        sidePanel
          .open({ tabId: laterPartner })
          .catch(error =>
            console.warn(
              'openTabSidePanelForSplit: cold-start partner open failed:',
              error
            )
          )
      })
    }
    return opening
  }

  const getPanelOptions = async (
    tabId: number
  ): Promise<chrome.sidePanel.PanelOptions | undefined> => {
    try {
      return await sidePanel.getOptions({ tabId })
    } catch (error) {
      console.warn('splitViewSidePanel: getOptions failed:', error)
      return undefined
    }
  }

  // User closed a panel on either side of a Split View pair: disable and
  // close the other when it still shows the same path. Ignores closes from
  // ownership replacement (path no longer matches) and our own teardown
  // (registration already disabled).
  const handleSplitSidePanelClosed = async (info: {
    tabId?: number
    path: string
  }): Promise<void> => {
    if (info.tabId === undefined) return

    const current = await getPanelOptions(info.tabId)
    if (!current?.enabled) return
    if ((current.path ?? '') !== info.path) return

    const ownerInPath = panelTabIdFromUrl(info.path)
    const otherTabId =
      ownerInPath !== undefined && ownerInPath !== info.tabId
        ? ownerInPath
        : getSplitPartner(info.tabId)
    if (otherTabId === undefined) return

    const other = await getPanelOptions(otherTabId)
    if (!other?.enabled || (other.path ?? '') !== info.path) return

    try {
      await sidePanel.setOptions({ tabId: otherTabId, enabled: false })
      await sidePanel.close({ tabId: otherTabId })
    } catch (error) {
      console.warn('splitViewSidePanel: failed to close partner panel:', error)
    }
  }

  // An enabled registration whose path names a tab that is gone or no longer
  // in the same Split View is a stale mirror: disable it.
  const disableStaleSplitPanelRegistration = async (
    tabId: number
  ): Promise<void> => {
    const options = await getPanelOptions(tabId)
    if (!options?.enabled) return
    const named = panelTabIdFromUrl(options.path)
    if (named === undefined) return
    if (areInSameSplit(tabId, named)) return

    try {
      // Disable first so the reciprocal onClosed (if close fires) sees a
      // disabled registration and does nothing (ADR-089 Decision 4).
      await sidePanel.setOptions({ tabId, enabled: false })
      await sidePanel.close({ tabId })
    } catch (error) {
      console.warn(
        'splitViewSidePanel: failed to disable stale registration:',
        error
      )
    }
  }

  const cleanupSplitPanelRegistrations = async (
    candidateTabIds: number[]
  ): Promise<void> => {
    const seen = new Set<number>()
    for (const tabId of candidateTabIds) {
      if (seen.has(tabId)) continue
      seen.add(tabId)
      await disableStaleSplitPanelRegistration(tabId)
    }
  }

  return {
    openTabSidePanelForSplit,
    handleSplitSidePanelClosed,
    cleanupSplitPanelRegistrations,
  }
}
