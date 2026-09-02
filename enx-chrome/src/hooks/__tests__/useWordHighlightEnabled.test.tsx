import { act, renderHook, waitFor } from '@testing-library/react'
import { useWordHighlightEnabled } from '@/hooks/useWordHighlightEnabled'
import { WORD_HIGHLIGHT_KEY } from '@/config/preferences'

const storage = chrome.storage.local as unknown as {
  get: jest.Mock
  set: jest.Mock
}
const onChanged = chrome.storage.onChanged as unknown as {
  addListener: jest.Mock
  removeListener: jest.Mock
}

const lastChangeListener = () =>
  onChanged.addListener.mock.calls.at(-1)![0] as (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => void

beforeEach(() => {
  jest.clearAllMocks()
  storage.set.mockResolvedValue(undefined)
})

it('loads the stored value on mount', async () => {
  storage.get.mockResolvedValue({ [WORD_HIGHLIGHT_KEY]: false })
  const { result } = renderHook(() => useWordHighlightEnabled())
  await waitFor(() => expect(result.current.enabled).toBe(false))
})

it('setEnabled updates state optimistically and persists', async () => {
  storage.get.mockResolvedValue({})
  const { result } = renderHook(() => useWordHighlightEnabled())
  await waitFor(() => expect(result.current.enabled).toBe(true))

  await act(async () => {
    await result.current.setEnabled(false)
  })

  expect(result.current.enabled).toBe(false)
  expect(storage.set).toHaveBeenCalledWith({ [WORD_HIGHLIGHT_KEY]: false })
})

it('reflects a change made from another surface (onChanged)', async () => {
  storage.get.mockResolvedValue({})
  const { result } = renderHook(() => useWordHighlightEnabled())
  await waitFor(() => expect(result.current.enabled).toBe(true))

  act(() => {
    lastChangeListener()({ [WORD_HIGHLIGHT_KEY]: { newValue: false } }, 'local')
  })
  expect(result.current.enabled).toBe(false)
})

it('unsubscribes on unmount', async () => {
  storage.get.mockResolvedValue({})
  const { unmount } = renderHook(() => useWordHighlightEnabled())
  await waitFor(() => expect(onChanged.addListener).toHaveBeenCalled())
  unmount()
  expect(onChanged.removeListener).toHaveBeenCalled()
})
