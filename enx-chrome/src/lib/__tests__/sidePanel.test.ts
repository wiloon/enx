import {
  closeTabSidePanel,
  isTabSidePanelOpen,
  latestPageWordKey,
  openActiveTabSidePanel,
  openTabSidePanel,
  panelTabIdFromUrl,
  pendingSentenceKey,
  sidePanelPath,
} from '../sidePanel'

// ADR-050: the Side Panel is always a tab-specific panel, and everything it
// reads or writes is keyed by the tab it belongs to.
describe('sidePanel (ADR-050)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(chrome.sidePanel.setOptions as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.sidePanel.open as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.sidePanel.close as jest.Mock).mockResolvedValue(undefined)
  })

  it('carries the owning tab in the panel path', () => {
    expect(sidePanelPath(42)).toBe('sidepanel.html?tabId=42')
  })

  it('keys the storage entries by tab', () => {
    expect(pendingSentenceKey(42)).toBe('enx-pending-sentence:42')
    expect(latestPageWordKey(42)).toBe('enx-latest-page-word:42')
    expect(pendingSentenceKey(1)).not.toBe(pendingSentenceKey(2))
  })

  it.each([
    ['?tabId=42', 42],
    ['chrome-extension://abc/sidepanel.html?tabId=7', 7],
    ['', undefined],
    ['?tabId=', undefined],
    ['?tabId=abc', undefined],
    ['chrome-extension://abc/sidepanel.html', undefined],
    [undefined, undefined],
  ])('reads the owning tab from %p', (url, expected) => {
    expect(panelTabIdFromUrl(url)).toBe(expected)
  })

  it('registers the tab-specific panel, then opens it, without awaiting in between', async () => {
    const calls: string[] = []
    let releaseSetOptions = () => {}
    ;(chrome.sidePanel.setOptions as jest.Mock).mockImplementation(() => {
      calls.push('setOptions')
      // Never settles until released: open() must not wait for it, because
      // any await spends the user gesture open() needs.
      return new Promise<void>(resolve => {
        releaseSetOptions = resolve
      })
    })
    ;(chrome.sidePanel.open as jest.Mock).mockImplementation(async () => {
      calls.push('open')
    })

    const opening = openTabSidePanel(42)

    expect(calls).toEqual(['setOptions', 'open'])
    expect(chrome.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: 'sidepanel.html?tabId=42',
      enabled: true,
    })
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 })
    releaseSetOptions()
    await expect(opening).resolves.toBeUndefined()
  })

  it('rejects when open() is refused, so callers can fall back', async () => {
    ;(chrome.sidePanel.open as jest.Mock).mockRejectedValue(
      new Error('may only be called in response to a user gesture')
    )
    await expect(openTabSidePanel(42)).rejects.toThrow('user gesture')
  })

  it("opens the current window's active tab's own panel (popup button)", async () => {
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 42 }])

    await openActiveTabSidePanel()

    expect(chrome.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    })
    expect(chrome.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: 'sidepanel.html?tabId=42',
      enabled: true,
    })
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 })
  })

  it('opens nothing when there is no active tab', async () => {
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([])

    await openActiveTabSidePanel()

    expect(chrome.sidePanel.open).not.toHaveBeenCalled()
  })

  describe('isTabSidePanelOpen', () => {
    const getContexts = chrome.runtime.getContexts as jest.Mock

    it("is true when the tab's own panel is live", async () => {
      getContexts.mockResolvedValue([
        {
          contextType: 'SIDE_PANEL',
          documentUrl: 'chrome-extension://abc/sidepanel.html?tabId=42',
        },
      ])
      await expect(isTabSidePanelOpen(42)).resolves.toBe(true)
    })

    it("ignores another tab's panel and non-panel contexts", async () => {
      getContexts.mockResolvedValue([
        {
          contextType: 'SIDE_PANEL',
          documentUrl: 'chrome-extension://abc/sidepanel.html?tabId=7',
        },
        {
          contextType: 'POPUP',
          documentUrl: 'chrome-extension://abc/popup.html?tabId=42',
        },
      ])
      await expect(isTabSidePanelOpen(42)).resolves.toBe(false)
    })

    it('treats a getContexts() failure as closed', async () => {
      getContexts.mockRejectedValue(new Error('boom'))
      await expect(isTabSidePanelOpen(42)).resolves.toBe(false)
    })
  })

  it("closes the tab's own panel", async () => {
    await closeTabSidePanel(42)
    expect(chrome.sidePanel.close).toHaveBeenCalledWith({ tabId: 42 })
  })
})
