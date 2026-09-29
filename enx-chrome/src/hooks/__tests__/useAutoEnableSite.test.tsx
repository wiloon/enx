import { act, renderHook, waitFor } from '@testing-library/react'
import { useAutoEnableSite } from '@/hooks/useAutoEnableSite'

const permissions = chrome.permissions as unknown as {
  contains: jest.Mock
  request: jest.Mock
  remove: jest.Mock
}
const tabs = chrome.tabs as unknown as { query: jest.Mock }

function activeTab(url: string) {
  tabs.query.mockResolvedValue([{ id: 1, url }])
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
    host_permissions: ['https://catglish.com/*'],
    content_scripts: [],
  })
  permissions.contains.mockResolvedValue(false)
})

it('offers the active tab site and reads its current grant', async () => {
  activeTab('https://www.infoq.com/news/1')
  permissions.contains.mockResolvedValue(true)

  const { result } = renderHook(() => useAutoEnableSite())

  await waitFor(() => expect(result.current.enabled).toBe(true))
  expect(result.current.site).toBe('https://www.infoq.com/*')
  expect(result.current.host).toBe('www.infoq.com')
  expect(permissions.contains).toHaveBeenCalledWith({
    origins: ['https://www.infoq.com/*'],
  })
})

it('offers nothing on a page that cannot be auto-enabled', async () => {
  activeTab('chrome://extensions')

  const { result } = renderHook(() => useAutoEnableSite())

  await waitFor(() => expect(tabs.query).toHaveBeenCalled())
  expect(result.current.site).toBeNull()
  expect(permissions.contains).not.toHaveBeenCalled()
})

it('turning it on requests the exact origin', async () => {
  activeTab('https://www.infoq.com/news/1')
  permissions.request.mockResolvedValue(true)
  const { result } = renderHook(() => useAutoEnableSite())
  await waitFor(() => expect(result.current.site).not.toBeNull())

  await act(async () => {
    await result.current.setEnabled(true)
  })

  expect(permissions.request).toHaveBeenCalledWith({
    origins: ['https://www.infoq.com/*'],
  })
  expect(result.current.enabled).toBe(true)
})

it('stays off when the user denies the permission dialog', async () => {
  activeTab('https://www.infoq.com/news/1')
  permissions.request.mockResolvedValue(false)
  const { result } = renderHook(() => useAutoEnableSite())
  await waitFor(() => expect(result.current.site).not.toBeNull())

  await act(async () => {
    await result.current.setEnabled(true)
  })

  expect(result.current.enabled).toBe(false)
})

it('turning it off gives the permission back', async () => {
  activeTab('https://www.infoq.com/news/1')
  permissions.contains.mockResolvedValue(true)
  permissions.remove.mockResolvedValue(true)
  const { result } = renderHook(() => useAutoEnableSite())
  await waitFor(() => expect(result.current.enabled).toBe(true))

  await act(async () => {
    await result.current.setEnabled(false)
  })

  expect(permissions.remove).toHaveBeenCalledWith({
    origins: ['https://www.infoq.com/*'],
  })
  expect(result.current.enabled).toBe(false)
})
