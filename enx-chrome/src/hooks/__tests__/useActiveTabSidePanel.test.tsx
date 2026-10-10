import { act, renderHook, waitFor } from '@testing-library/react'
import { useActiveTabSidePanel } from '@/hooks/useActiveTabSidePanel'

const sidePanel = chrome.sidePanel as unknown as {
  open: jest.Mock
  close: jest.Mock
  setOptions: jest.Mock
  onOpened: { addListener: jest.Mock; removeListener: jest.Mock }
  onClosed: { addListener: jest.Mock; removeListener: jest.Mock }
}
const query = chrome.tabs.query as jest.Mock
const getContexts = chrome.runtime.getContexts as jest.Mock

const panelOf = (tabId: number) => ({
  contextType: 'SIDE_PANEL',
  documentUrl: `chrome-extension://abc/sidepanel.html?tabId=${tabId}`,
})

const lastListener = (event: { addListener: jest.Mock }) =>
  event.addListener.mock.calls.at(-1)![0] as (info: {
    tabId?: number
    windowId: number
    path: string
  }) => void

// Renders the hook and waits until the active-tab lookup and the open-state
// probe have both run.
const renderReady = async () => {
  const hook = renderHook(() => useActiveTabSidePanel())
  await waitFor(() => expect(getContexts).toHaveBeenCalled())
  return hook
}

beforeEach(() => {
  jest.clearAllMocks()
  query.mockResolvedValue([{ id: 42 }])
  getContexts.mockResolvedValue([])
  sidePanel.open.mockResolvedValue(undefined)
  sidePanel.close.mockResolvedValue(undefined)
  sidePanel.setOptions.mockResolvedValue(undefined)
})

it("starts open when the active tab's panel is already open", async () => {
  getContexts.mockResolvedValue([panelOf(42)])
  const { result } = renderHook(() => useActiveTabSidePanel())
  await waitFor(() => expect(result.current.open).toBe(true))
})

it("starts closed when only another tab's panel is open", async () => {
  getContexts.mockResolvedValue([panelOf(7)])
  const { result } = await renderReady()
  expect(result.current.open).toBe(false)
})

it('opens on the first click and closes on the second', async () => {
  const { result } = await renderReady()

  await act(async () => {
    await result.current.toggle()
  })
  expect(sidePanel.open).toHaveBeenCalledWith({ tabId: 42 })
  expect(result.current.open).toBe(true)

  await act(async () => {
    await result.current.toggle()
  })
  expect(sidePanel.close).toHaveBeenCalledWith({ tabId: 42 })
  expect(result.current.open).toBe(false)
})

it('calls open() before any await, so the click gesture is not spent', async () => {
  const { result } = await renderReady()

  let toggling: Promise<void> = Promise.resolve()
  act(() => {
    toggling = result.current.toggle()
  })
  // Synchronously after the click, before any microtask runs.
  expect(sidePanel.open).toHaveBeenCalledWith({ tabId: 42 })
  await act(() => toggling)
})

it('stays closed when Chrome refuses to open the panel', async () => {
  sidePanel.open.mockRejectedValue(new Error('no user gesture'))
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const { result } = await renderReady()

  await act(async () => {
    await result.current.toggle()
  })

  expect(result.current.open).toBe(false)
  errorSpy.mockRestore()
})

it("follows the active tab's panel being opened or closed elsewhere", async () => {
  const { result } = await renderReady()

  act(() =>
    lastListener(sidePanel.onOpened)({ tabId: 42, windowId: 1, path: '' })
  )
  expect(result.current.open).toBe(true)

  act(() =>
    lastListener(sidePanel.onClosed)({ tabId: 42, windowId: 1, path: '' })
  )
  expect(result.current.open).toBe(false)
})

it("ignores another tab's panel events", async () => {
  const { result } = await renderReady()

  act(() =>
    lastListener(sidePanel.onOpened)({ tabId: 7, windowId: 1, path: '' })
  )
  expect(result.current.open).toBe(false)
})

it('removes its listeners on unmount', async () => {
  const { unmount } = await renderReady()
  const opened = lastListener(sidePanel.onOpened)
  const closed = lastListener(sidePanel.onClosed)

  unmount()

  expect(sidePanel.onOpened.removeListener).toHaveBeenCalledWith(opened)
  expect(sidePanel.onClosed.removeListener).toHaveBeenCalledWith(closed)
})
