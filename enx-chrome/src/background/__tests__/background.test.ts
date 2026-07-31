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
