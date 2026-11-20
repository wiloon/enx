/**
 * Popup saved pages keyed by the selected auth adapter's subject (ADR-032 /
 * ADR-036). Seeds storage with literal pre-change keys, not through
 * storageKeyFor, so a wrong subject forwarded to useSavedPage fails the test.
 */
import {
  act,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'

const PAGE_URL = 'https://example.com/article'

const harness = {
  subject: 'user-a',
  listeners: new Set<() => void>(),
  selectPopupAuth: null as jest.Mock | null,
}

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
jest.mock('@/components/CatglishLogo', () => () => (
  <div data-testid="catglish-logo" />
))
jest.mock('@/components/ArticleChoiceControl', () => () => null)
jest.mock('@/components/LearningModeCard', () => () => null)
jest.mock('@/components/DebugPanel', () => () => null)
jest.mock('@/components/PageReportPrompt', () => () => null)
jest.mock('@/components/SendFeedback', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('@/hooks/useActiveTabSidePanel', () => ({
  useActiveTabSidePanel: () => ({ open: false, toggle: jest.fn() }),
}))
jest.mock('@/hooks/useAutoEnableSite', () => ({
  useAutoEnableSite: () => ({ site: null }),
}))
jest.mock('@/hooks/useWordHighlightEnabled', () => ({
  useWordHighlightEnabled: () => ({
    enabled: false,
    setEnabled: jest.fn(),
  }),
}))
jest.mock('@/lib/enableLearningMode', () => ({
  disableLearningModeOnTab: jest.fn(),
  enableLearningModeOnTab: jest.fn(),
  getLearningModeStatusOnTab: jest.fn(async () => 'off'),
}))
jest.mock('@/lib/learningModeCommand', () => ({
  learningModeShortcut: () => undefined,
  openShortcutSettings: jest.fn(),
}))
jest.mock('@/lib/learningModeStatus', () => ({
  isLearningModeOn: () => false,
}))

jest.mock('@/lib/auth/selectPopupAuth', () => {
  const React = require('react') as typeof import('react')
  const { AuthContextProvider } = require('@/lib/auth/context') as {
    AuthContextProvider: typeof import('@/lib/auth/context').AuthContextProvider
  }

  function FakeAuthProvider({ children }: { children: React.ReactNode }) {
    const snapshot = React.useSyncExternalStore(
      (listener: () => void) => {
        harness.listeners.add(listener)
        return () => harness.listeners.delete(listener)
      },
      () => harness.subject
    )
    const user = React.useMemo(
      () => ({
        id: snapshot,
        fullName: snapshot,
        username: snapshot,
        primaryEmail: `${snapshot}@example.com`,
      }),
      [snapshot]
    )
    const value = React.useMemo(
      () => ({
        isLoaded: true,
        isSignedIn: true,
        user,
        sessionId: `sess-${snapshot}`,
        signOut: async () => {},
      }),
      [user]
    )
    return React.createElement(AuthContextProvider, { value }, children)
  }

  const selectPopupAuth = jest.fn(() => ({ Provider: FakeAuthProvider }))
  harness.selectPopupAuth = selectPopupAuth
  return { selectPopupAuth }
})

import Popup from '../Popup'

let stored: Record<string, unknown>

beforeEach(() => {
  harness.subject = 'user-a'
  stored = {
    // Literal pre-change keys — not storageKeyFor(...).
    'savedPages:user-a': {
      [PAGE_URL]: { id: 'page-a', url: PAGE_URL },
    },
    'savedPages:user-b': {},
  }
  ;(chrome.storage.local.get as jest.Mock).mockImplementation(
    async (key: string) => (key in stored ? { [key]: stored[key] } : {})
  )
  ;(chrome.storage.local.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      Object.assign(stored, items)
    }
  )
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
    { id: 1, url: PAGE_URL, title: 'An article' },
  ])
  ;(chrome.commands.getAll as jest.Mock).mockResolvedValue([])
  ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
    version: '0.0.0',
  })
})

describe('Popup saved pages through the selected auth adapter', () => {
  it('selects the popup adapter from the stamped clerk provider', () => {
    // Called once when Popup.tsx loads (production entry), not on each render.
    expect(harness.selectPopupAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'clerk' })
    )
    render(<Popup />)
  })

  it('shows user-a saved state, then user-b after the adapter subject switches', async () => {
    render(<Popup />)

    await waitFor(() => {
      expect(screen.getByTestId('save-link-card')).toBeInTheDocument()
    })
    expect(
      within(screen.getByTestId('save-link-card')).getByText('Link saved')
    ).toBeInTheDocument()

    await act(async () => {
      harness.subject = 'user-b'
      harness.listeners.forEach(l => l())
    })

    await waitFor(() => {
      expect(
        within(screen.getByTestId('save-link-card')).getByTestId(
          'save-link-save'
        )
      ).toBeInTheDocument()
    })
  })
})
