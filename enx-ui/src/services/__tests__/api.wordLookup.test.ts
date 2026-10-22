import { ApiService } from '../api'

describe('ApiService.lookupWord failures', () => {
  let errorLog: jest.SpyInstance

  beforeEach(() => {
    ;(global.fetch as jest.Mock) = jest.fn()
    errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    expect(errorLog).toHaveBeenCalled()
    errorLog.mockRestore()
  })

  it('keeps the status of a non-2xx answer and does not call it a network failure', async () => {
    const service = new ApiService('http://localhost:8090')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ message: 'Dictionary unavailable' }),
    })

    const result = await service.lookupWord('run')

    expect(result.status).toBe(503)
    expect(result.networkFailure).toBeUndefined()
  })

  it('does not call a 2xx answer with a broken body a network failure', async () => {
    const service = new ApiService('http://localhost:8090')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })

    const result = await service.lookupWord('run')

    expect(result.success).toBe(false)
    expect(result.status).toBeUndefined()
    expect(result.networkFailure).toBeUndefined()
  })

  it('does not call the disabled-account short-circuit a network failure', async () => {
    const service = new ApiService('http://localhost:8090')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ code: 'account_disabled' }),
    })
    await service.lookupWord('run')

    const result = await service.lookupWord('run')

    expect(service.isAccountDisabled()).toBe(true)
    expect(result.success).toBe(false)
    expect(result.status).toBeUndefined()
    expect(result.networkFailure).toBeUndefined()
  })
})

describe('ApiService.recordWordLookup', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('POSTs the word id to /api/me/word-lookups, without fromCache', async () => {
    const service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ queryCount: 4, known: false }),
    })

    const result = await service.recordWordLookup('w1')

    expect(result).toEqual({
      success: true,
      data: { queryCount: 4, known: false },
    })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/me/word-lookups')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ wordId: 'w1' })
  })
})
