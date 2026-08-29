// Avoid loading the real env.ts (uses `import.meta`, which ts-jest can't parse
// under CommonJS) and keep Cognito network calls fully mocked.
jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    cognitoDomain: 'https://enx-auth.auth.us-east-1.amazoncognito.com',
    cognitoClientId: '645kitlgap7l1q4ebrfkmi9ltv',
    environment: 'test',
  },
  getApiBaseUrl: jest.fn(async () => 'http://localhost:8090'),
}))

jest.mock('@/lib/cognito', () => ({
  refreshCognitoTokens: jest.fn(),
  signInWithCognito: jest.fn(),
  signOutWithCognito: jest.fn(),
}))

import { refreshCognitoTokens } from '@/lib/cognito'
import { loadSession, makeApiRequest } from '../background'

// Captured immediately at import time, before any test's `resetAllMocks()`
// wipes `chrome.runtime.onMessage.addListener`'s call history: importing
// `../background` registers this listener as a top-level side effect.
const onMessageListener = (chrome.runtime.onMessage.addListener as jest.Mock)
  .mock.calls[0][0] as (
  request: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean

function jsonResponse(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Unauthorized',
    json: async () => body,
  }
}

describe('background makeApiRequest / token refresh', () => {
  let storageFixture: Record<string, unknown>

  beforeEach(async () => {
    jest.resetAllMocks()

    storageFixture = { accessToken: 'old-access-token', refreshToken: 'valid-refresh-token' }
    ;(chrome.storage.local.get as jest.Mock).mockImplementation(
      async (keys: string[]) => {
        const result: Record<string, unknown> = {}
        for (const key of keys) {
          if (key in storageFixture) result[key] = storageFixture[key]
        }
        return result
      }
    )
    ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock) = jest.fn()

    // Seed the module's in-memory accessToken/refreshToken from the fixture above.
    await loadSession()
  })

  it('loadSession reads both accessToken and refreshToken into memory', async () => {
    await makeApiRequest('/api/me')

    expect(chrome.storage.local.get).toHaveBeenCalledWith([
      'accessToken',
      'refreshToken',
    ])
    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    expect(requestInit.headers.Authorization).toBe('Bearer old-access-token')
  })

  it('silently refreshes the token on 401 and retries the request once', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { English: 'test' }))
    ;(refreshCognitoTokens as jest.Mock).mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    })

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({ success: true, data: { English: 'test' } })
    expect(refreshCognitoTokens).toHaveBeenCalledWith('valid-refresh-token')
    expect(global.fetch).toHaveBeenCalledTimes(2)

    // Retried request must use the newly refreshed access token.
    const [, retryInit] = (global.fetch as jest.Mock).mock.calls[1]
    expect(retryInit.headers.Authorization).toBe('Bearer new-access-token')

    // New tokens persisted, and the session-expired path must not fire.
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      })
    )
    expect(chrome.tabs.query).not.toHaveBeenCalled()
    expect(chrome.storage.local.remove).not.toHaveBeenCalled()
  })

  it('falls through to session-expired when the refresh call itself fails', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, {}))
    ;(refreshCognitoTokens as jest.Mock).mockRejectedValue(
      new Error('Token refresh failed: 400')
    )

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({
      success: false,
      error: 'Your session has expired. Please login again.',
      sessionExpired: true,
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(
      expect.arrayContaining(['accessToken', 'refreshToken', 'enx-session'])
    )
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ action: 'sessionExpired' })
    )
  })

  it('does not retry more than once if the refreshed token is still rejected', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))
    ;(refreshCognitoTokens as jest.Mock).mockResolvedValue({
      access_token: 'new-access-token',
    })

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toMatchObject({ success: false, sessionExpired: true })
    expect(global.fetch).toHaveBeenCalledTimes(2) // original + exactly one retry
    expect(refreshCognitoTokens).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent refresh calls triggered by simultaneous 401s', async () => {
    let fetchCallCount = 0
    ;(global.fetch as jest.Mock).mockImplementation(async () => {
      fetchCallCount += 1
      return fetchCallCount <= 2
        ? jsonResponse(401, {})
        : jsonResponse(200, { ok: true })
    })
    ;(refreshCognitoTokens as jest.Mock).mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    })

    const [resultA, resultB] = await Promise.all([
      makeApiRequest('/api/translate?word=a'),
      makeApiRequest('/api/translate?word=b'),
    ])

    expect(resultA.success).toBe(true)
    expect(resultB.success).toBe(true)
    expect(refreshCognitoTokens).toHaveBeenCalledTimes(1)
  })
})

describe('background onMessage / validateSession', () => {
  const listener = onMessageListener

  let storageFixture: Record<string, unknown>

  beforeEach(async () => {
    jest.resetAllMocks()

    storageFixture = {
      accessToken: 'old-access-token',
      refreshToken: 'valid-refresh-token',
    }
    ;(chrome.storage.local.get as jest.Mock).mockImplementation(
      async (keys: string[]) => {
        const result: Record<string, unknown> = {}
        for (const key of keys) {
          if (key in storageFixture) result[key] = storageFixture[key]
        }
        return result
      }
    )
    ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock) = jest.fn()

    await loadSession()
  })

  it('routes popup session checks through makeApiRequest, including its silent refresh', async () => {
    // Same scenario as the "silently refreshes" test above (§3.5 fix): a
    // popup validateSession check that hits an expired access token must
    // get the same refresh-and-retry treatment as content-script requests,
    // instead of the old ApiService path that gave up on the first 401.
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: '1',
          name: 'Test User',
          email: 'test@example.com',
          status: 'active',
        })
      )
    ;(refreshCognitoTokens as jest.Mock).mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    })

    const response = await new Promise(resolve => {
      const keepChannelOpen = listener(
        { type: 'validateSession' },
        {},
        resolve
      )
      expect(keepChannelOpen).toBe(true)
    })

    expect(response).toEqual({
      success: true,
      data: {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        status: 'active',
      },
    })
    expect(refreshCognitoTokens).toHaveBeenCalledWith('valid-refresh-token')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('reports session-expired when refresh also fails, without clearing storage twice', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, {}))
    ;(refreshCognitoTokens as jest.Mock).mockRejectedValue(
      new Error('Token refresh failed: 400')
    )

    const response = await new Promise(resolve => {
      listener({ type: 'validateSession' }, {}, resolve)
    })

    expect(response).toEqual({
      success: false,
      error: 'Your session has expired. Please login again.',
      sessionExpired: true,
    })
    expect(chrome.storage.local.remove).toHaveBeenCalledTimes(1)
  })
})

// ADR-008: the phrase-in-context lookup reuses the 'openSentencePanel'
// message/handler, just with an extra `phrase` field threaded through to
// PendingSentenceContext. Verifies that plumbing independently of
// content.tsx (which can't be imported in Jest -- see phraseAnchor.test.ts).
describe('background onMessage / openSentencePanel phrase passthrough (ADR-008)', () => {
  const listener = onMessageListener

  beforeEach(() => {
    jest.resetAllMocks()
    ;(chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.sidePanel.open as jest.Mock).mockResolvedValue(undefined)
  })

  it('threads request.phrase into the stored PendingSentenceContext', async () => {
    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: '',
          phrase: 'hunt down emails',
          sentence: 'I had to hunt down emails and draft outreach.',
          sourceUrl: 'https://example.com/post',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'enx-pending-sentence': expect.objectContaining({
          word: '',
          phrase: 'hunt down emails',
          sentence: 'I had to hunt down emails and draft outreach.',
        }),
      })
    )
  })

  it('skips sidePanel.open() and still reports panelOpened when a Side Panel context exists (regardless of its windowId)', async () => {
    ;(chrome.runtime.getContexts as jest.Mock).mockResolvedValue([
      { contextType: 'BACKGROUND' },
      // windowId deliberately does NOT match sender.tab.windowId -- Chrome's
      // SIDE_PANEL context windowId is unreliable, so this must still count.
      { contextType: 'SIDE_PANEL', windowId: 999 },
    ])

    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: 'great',
          sentence: 'Cats are great pets.',
          sourceUrl: 'https://example.com/post',
        },
        { tab: { id: 7, windowId: 3 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.storage.session.set).toHaveBeenCalled()
    expect(chrome.sidePanel.open).not.toHaveBeenCalled()
  })

  it('leaves phrase undefined for the existing whole-sentence/single-word callers', async () => {
    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: 'great',
          sentence: 'Cats are great pets.',
          sourceUrl: 'https://example.com/post',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'enx-pending-sentence': expect.objectContaining({
          word: 'great',
          phrase: undefined,
        }),
      })
    )
  })
})
