// ADR-010 Decision 8: after a failure on a page Catglish could not read, the
// popup offers to report the page, and sends only when the user says so.

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const PAGE_URL = 'https://example.com/article'

jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    auth: {
      provider: 'clerk',
      publishableKey: 'pk_test_x',
      syncHost: 'https://clerk.localhost.test',
    },
    uiOrigins: ['http://localhost:3000'],
    rssxOrigins: [],
    environment: 'test',
    buildCommit: 'abc',
    builtAt: '2026-01-01T00:00:00.000Z',
  },
}))

jest.mock('@/lib/sentry', () => ({ initSentry: jest.fn() }))
jest.mock('@/components/ArticleChoiceControl', () => () => null)
jest.mock('@/components/DebugPanel', () => () => null)
jest.mock('@/components/PopupStatsSection', () => () => null)
// The popup's body is SendFeedback's children.
jest.mock('@/components/SendFeedback', () => ({
  __esModule: true,
  default: function MockSendFeedback({ children }: { children: ReactNode }) {
    return <div>{children}</div>
  },
}))
jest.mock('@/hooks/useActiveTabSidePanel', () => ({
  useActiveTabSidePanel: () => ({ open: false, toggle: jest.fn() }),
}))
jest.mock('@/hooks/useAutoEnableSite', () => ({
  useAutoEnableSite: () => ({ site: null }),
}))
jest.mock('@/hooks/useSavedPage', () => ({
  useSavedPage: () => ({ tab: null, saved: null, busy: null }),
}))
jest.mock('@/lib/enableLearningMode', () => ({
  disableLearningModeOnTab: jest.fn(),
  enableLearningModeOnTab: jest.fn(async () => ({
    success: false,
    reason: 'no-article-node',
    adapter: 'generic',
    error: "Catglish couldn't find an article on this page.",
  })),
  getLearningModeStatusOnTab: jest.fn(async () => ({ status: 'off' })),
}))
jest.mock('@/lib/auth/selectPopupAuth', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const mod =
    require('@/test/fakePopupAuthHarness') as typeof import('@/test/fakePopupAuthHarness')
  return { selectPopupAuth: () => ({ Provider: mod.FakeAuthProvider }) }
})

import Popup from '../Popup'

const sendMessage = chrome.runtime.sendMessage as jest.Mock

beforeEach(() => {
  sendMessage.mockReset()
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
    { id: 1, url: PAGE_URL, title: 'An article' },
  ])
  ;(chrome.commands.getAll as jest.Mock).mockResolvedValue([])
  ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
    version: '0.0.0',
  })
})

const failToEnable = async () => {
  render(<Popup />)
  fireEvent.click(
    await screen.findByRole('button', { name: /Read with Catglish/ })
  )
  return screen.findByRole('button', { name: 'Send report' })
}

const reportsSent = () =>
  sendMessage.mock.calls.filter(
    ([message]) => (message as { type?: string }).type === 'submitPageReport'
  )

it('sends nothing until the user presses Send report', async () => {
  await failToEnable()

  expect(reportsSent()).toHaveLength(0)
})

it('sends the page address, the failure and the adapter to the background', async () => {
  sendMessage.mockResolvedValue({ success: true })

  fireEvent.click(await failToEnable())

  expect(await screen.findByText(/report sent/)).toBeInTheDocument()
  expect(reportsSent()).toEqual([
    [
      {
        type: 'submitPageReport',
        pageReport: {
          url: PAGE_URL,
          reason: 'no-article-node',
          adapter: 'generic',
        },
      },
    ],
  ])
})

it('says the report was not sent when the background cannot be reached', async () => {
  sendMessage.mockRejectedValue(new Error('Could not establish connection.'))

  fireEvent.click(await failToEnable())

  expect(
    await screen.findByText("Couldn't send the report. Try again in a moment.")
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Send report' })
  ).toBeInTheDocument()
})
