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
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    const clerkError = new Error('clerk down')
    service.setTokenGetter(jest.fn().mockRejectedValue(clerkError))
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, {}))

    await service.getMe()

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
    expect(errorLog).toHaveBeenCalledWith('Clerk getToken failed:', clerkError)
  })

  // Clerk hands out a fresh token on every call, so a rejected token from a
  // signed-in reader is our fault (e.g. the site's origin missing from the
  // API's authorized parties), not an expired session.
  it('points a rejected sign-in to support, not to "Session expired"', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    service.setTokenGetter(jest.fn().mockResolvedValue('clerk-session-jwt'))
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(401, { error: 'invalid token' })
    )

    const result = await service.getMe()

    expect(result).toEqual({
      success: false,
      error:
        "We couldn't verify your sign-in. Refresh the page; if this keeps happening, contact support@catglish.com.",
      status: 401,
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(errorLog).toHaveBeenCalledWith(
      'API request failed:',
      expect.any(Error)
    )
  })

  it('asks the reader to refresh when the server says the token expired', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    service.setTokenGetter(jest.fn().mockResolvedValue('stale-jwt'))
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(401, { error: 'token expired' })
    )

    const result = await service.getMe()

    expect(result).toEqual({
      success: false,
      error: 'Your session has expired. Refresh the page to sign in again.',
      status: 401,
    })
    expect(errorLog).toHaveBeenCalledWith(
      'API request failed:',
      expect.any(Error)
    )
  })

  // The auth middleware's 5xx bodies ({"error": "internal server error"},
  // {"error": "auth service unavailable"}) are internal wording.
  it('hides an internal 5xx error string behind a contact-support hint', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(500, { error: 'internal server error' })
    )

    const result = await service.getMe()

    expect(result).toEqual({
      success: false,
      error:
        'Something went wrong on our end. Refresh the page, or try again in a few minutes. If this keeps happening, contact support@catglish.com.',
      status: 500,
    })
    expect(errorLog).toHaveBeenCalledWith(
      'API request failed:',
      expect.any(Error)
    )
  })

  it("keeps a handler's own 5xx message and adds a contact-support hint", async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(502, {
        success: false,
        message: 'failed to create checkout session',
      })
    )

    const result = await service.createTopupCheckout('small')

    expect(result).toEqual({
      success: false,
      error:
        'Failed to create checkout session. If this keeps happening, contact support@catglish.com.',
      status: 502,
    })
    expect(errorLog).toHaveBeenCalledWith(
      'API request failed:',
      expect.any(Error)
    )
  })

  it("says the API can't be reached when the request never gets an answer", async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    const networkError = new TypeError('Failed to fetch')
    ;(global.fetch as jest.Mock).mockRejectedValue(networkError)

    const result = await service.getMe()

    expect(result).toEqual({
      success: false,
      error:
        "Can't reach Catglish right now. Check your connection and try again.",
    })
    expect(errorLog).toHaveBeenCalledWith(
      'API request got no answer:',
      networkError
    )
  })

  // ADR-060 Decision 4: the request rate limit's 429 says to slow down in
  // the server's own words -- never "Session expired", never a retry.
  it('shows a rate-limit 429 in the server message without retrying', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    service.setTokenGetter(jest.fn().mockResolvedValue('clerk-session-jwt'))
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(429, {
        success: false,
        code: 'too_many_requests',
        message:
          'Too many requests. Please slow down and try again in a moment.',
      })
    )

    const result = await service.getMe()

    expect(result).toEqual({
      success: false,
      error: 'Too many requests. Please slow down and try again in a moment.',
      status: 429,
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(errorLog).toHaveBeenCalledWith(
      'API request failed:',
      expect.any(Error)
    )
  })

  // A 5xx with no message of its own (e.g. enx-api unreachable while the
  // proxy forwards to it) shows a hint the reader can act on, not "HTTP 500:".
  it('shows a try-again hint for a server error without a message', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: '',
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input')
      },
    })

    const result = await service.getMe()

    expect(result).toEqual({
      success: false,
      error:
        'Something went wrong on our end. Refresh the page, or try again in a few minutes. If this keeps happening, contact support@catglish.com.',
      status: 500,
    })
    expect(errorLog).toHaveBeenCalledWith(
      'API request failed:',
      expect.any(Error)
    )
  })
})
