jest.mock('@/lib/cognito', () => ({
  refreshCognitoTokens: jest.fn(),
}))

import { refreshCognitoTokens } from '@/lib/cognito'
import { ApiService } from '../api'

function jsonResponse(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Unauthorized',
    json: async () => body,
  }
}

describe('ApiService token refresh', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('old-access-token')
    service.setRefreshToken('valid-refresh-token')
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('silently refreshes the token on 401 and retries the request once', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { name: 'test-user' }))
    ;(refreshCognitoTokens as jest.Mock).mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    })

    const onTokensRefreshed = jest.fn()
    service.setOnTokensRefreshed(onTokensRefreshed)

    const result = await service.getMe()

    expect(result).toEqual({ success: true, data: { name: 'test-user' } })
    expect(refreshCognitoTokens).toHaveBeenCalledWith('valid-refresh-token')
    expect(global.fetch).toHaveBeenCalledTimes(2)

    const [, retryInit] = (global.fetch as jest.Mock).mock.calls[1]
    expect(retryInit.headers.Authorization).toBe('Bearer new-access-token')
    expect(onTokensRefreshed).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'new-access-token' })
    )
  })

  it('surfaces "Session expired" when the refresh call itself fails', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, {}))
    ;(refreshCognitoTokens as jest.Mock).mockRejectedValue(
      new Error('Token refresh failed: 400')
    )

    const result = await service.getMe()

    expect(result).toEqual({ success: false, error: 'Session expired' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry more than once if the refreshed token is still rejected', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))
    ;(refreshCognitoTokens as jest.Mock).mockResolvedValue({
      access_token: 'new-access-token',
    })

    const result = await service.getMe()

    expect(result).toEqual({ success: false, error: 'Session expired' })
    expect(global.fetch).toHaveBeenCalledTimes(2)
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
      service.getMe(),
      service.lookupWord('test'),
    ])

    expect(resultA.success).toBe(true)
    expect(resultB.success).toBe(true)
    expect(refreshCognitoTokens).toHaveBeenCalledTimes(1)
  })

  it('does not attempt a refresh when no refresh token is available', async () => {
    service.setRefreshToken('')
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    const result = await service.getMe()

    expect(result).toEqual({ success: false, error: 'Session expired' })
    expect(refreshCognitoTokens).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
