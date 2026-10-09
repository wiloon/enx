import { act, renderHook, waitFor } from '@testing-library/react'
import { useSavedPage } from '@/hooks/useSavedPage'
import { storageKeyFor } from '@/lib/savedPagesStore'

const tabs = chrome.tabs as unknown as { query: jest.Mock }
const sendMessage = chrome.runtime.sendMessage as unknown as jest.Mock

let stored: Record<string, unknown>

beforeEach(() => {
  jest.clearAllMocks()
  stored = {}
  ;(chrome.storage.local.get as jest.Mock).mockImplementation(
    async (key: string) => (key in stored ? { [key]: stored[key] } : {})
  )
  ;(chrome.storage.local.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      stored = { ...stored, ...JSON.parse(JSON.stringify(items)) }
    }
  )
})

function activeTab(url: string, title = 'An article') {
  tabs.query.mockResolvedValue([{ id: 1, url, title }])
}

const PAGE = { id: 'p1', url: 'https://example.com/a' }

async function renderLoaded(userId = 'u1') {
  const hook = renderHook(() => useSavedPage(userId))
  await waitFor(() => expect(hook.result.current.tab).not.toBeNull())
  return hook
}

it('offers the active tab as unsaved and sends nothing when the popup opens', async () => {
  activeTab('https://example.com/a?utm_source=x')

  const { result } = await renderLoaded()

  expect(result.current.tab).toEqual({
    url: 'https://example.com/a?utm_source=x',
    title: 'An article',
  })
  expect(result.current.saved).toBeNull()
  expect(sendMessage).not.toHaveBeenCalled()
})

it('offers nothing on a page that is not a web page', async () => {
  activeTab('chrome://extensions')

  const { result } = renderHook(() => useSavedPage('u1'))

  await waitFor(() => expect(tabs.query).toHaveBeenCalled())
  expect(result.current.tab).toBeNull()
})

it('one click saves the link and remembers it locally', async () => {
  activeTab('https://example.com/a#top')
  sendMessage.mockResolvedValue({
    success: true,
    data: { success: true, created: true, page: PAGE },
  })
  const { result } = await renderLoaded()

  await act(async () => {
    await result.current.save()
  })

  expect(sendMessage).toHaveBeenCalledWith({
    type: 'savePage',
    savedPage: { url: 'https://example.com/a#top', title: 'An article' },
  })
  expect(result.current.saved).toEqual(PAGE)
  expect(stored[storageKeyFor('u1')]).toMatchObject({
    'https://example.com/a': PAGE,
  })
})

it('shows a page saved earlier as saved when the popup opens again', async () => {
  stored[storageKeyFor('u1')] = { 'https://example.com/a': PAGE }
  activeTab('https://example.com/a?fbclid=1')

  const { result } = await renderLoaded()

  expect(result.current.saved).toEqual(PAGE)
  expect(sendMessage).not.toHaveBeenCalled()
})

it('remove deletes it by id and forgets it locally', async () => {
  stored[storageKeyFor('u1')] = { 'https://example.com/a': PAGE }
  activeTab('https://example.com/a')
  sendMessage.mockResolvedValue({ success: true, data: { success: true } })
  const { result } = await renderLoaded()

  await act(async () => {
    await result.current.remove()
  })

  expect(sendMessage).toHaveBeenCalledWith({
    type: 'removeSavedPage',
    savedPageId: 'p1',
  })
  expect(result.current.saved).toBeNull()
  expect(stored[storageKeyFor('u1')]).toEqual({})
})

it('treats a page already removed elsewhere as removed', async () => {
  stored[storageKeyFor('u1')] = { 'https://example.com/a': PAGE }
  activeTab('https://example.com/a')
  sendMessage.mockResolvedValue({
    success: false,
    status: 404,
    error: 'saved page not found',
  })
  const { result } = await renderLoaded()

  await act(async () => {
    await result.current.remove()
  })

  expect(result.current.saved).toBeNull()
  expect(result.current.error).toBeUndefined()
})

it("shows the server's message and keeps the page unsaved when saving is refused", async () => {
  activeTab('https://example.com/a')
  sendMessage.mockResolvedValue({
    success: false,
    status: 422,
    error: 'You can save up to 1000 pages. Delete some to save more.',
  })
  const { result } = await renderLoaded()

  await act(async () => {
    await result.current.save()
  })

  expect(result.current.saved).toBeNull()
  expect(result.current.error).toBe(
    'You can save up to 1000 pages. Delete some to save more.'
  )
  expect(stored).toEqual({})
})

it('keeps the page saved and shows an error when removing fails', async () => {
  stored[storageKeyFor('u1')] = { 'https://example.com/a': PAGE }
  activeTab('https://example.com/a')
  sendMessage.mockResolvedValue({ success: false, status: 500 })
  const { result } = await renderLoaded()

  await act(async () => {
    await result.current.remove()
  })

  expect(result.current.saved).toEqual(PAGE)
  expect(result.current.error).toBe(
    "Couldn't remove this link. Try again in a moment."
  )
})
