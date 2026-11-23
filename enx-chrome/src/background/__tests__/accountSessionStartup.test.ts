import { waitFor } from '@testing-library/dom'

jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    auth: {
      provider: 'clerk' as const,
      publishableKey: 'pk_test_x',
      syncHost: 'https://clerk.localhost.test',
    },
    uiOrigins: ['http://localhost:3000'],
    environment: 'test',
  },
}))
jest.mock('@/lib/auth/selectWorkerAuth', () =>
  jest.requireActual('@/test/fakeWorkerAuth')
)
import { createClient, fakeSession } from '@/test/fakeWorkerAuth'

it('invalidates pages from account A when a cold worker syncs account B', async () => {
  ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
    'enx-account-session-owner': 'user-a',
  })
  ;(chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined)
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }])
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({ success: true })
  createClient.mockResolvedValue(fakeSession('user-b'))
  await import('../background')
  await waitFor(() => {
    for (const id of [1, 2]) {
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(id, {
        action: 'accountChanged',
      })
    }
  })
  expect(chrome.storage.session.set).toHaveBeenCalledWith({
    'enx-account-session-owner': 'user-b',
  })
})
