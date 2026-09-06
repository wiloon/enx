import { ApiService } from '../api'

function jsonResponse(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Unauthorized',
    json: async () => body,
  }
}

describe('ApiService auth token', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('attaches the Clerk token getter result as a Bearer header', async () => {
    const getToken = jest.fn().mockResolvedValue('clerk-session-jwt')
    service.setTokenGetter(getToken)
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { name: 'test-user' })
    )

    const result = await service.getMe()

    expect(result).toEqual({ success: true, data: { name: 'test-user' } })
    expect(getToken).toHaveBeenCalledTimes(1)
    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer clerk-session-jwt')
  })

  it('falls back to a statically supplied access token when no getter is set', async () => {
    service.setAccessToken('static-token')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, {}))

    await service.getMe()

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer static-token')
  })

  it('sends no Authorization header when the token getter throws', async () => {
    service.setTokenGetter(jest.fn().mockRejectedValue(new Error('clerk down')))
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, {}))

    await service.getMe()

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('surfaces "Session expired" on a 401 without retrying', async () => {
    service.setTokenGetter(jest.fn().mockResolvedValue('stale-jwt'))
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    const result = await service.getMe()

    expect(result).toEqual({ success: false, error: 'Session expired' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
