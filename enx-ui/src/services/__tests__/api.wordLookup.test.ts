import { ApiService } from '../api'

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

describe('ApiService quota refusals', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock) = jest.fn()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  const refusal = (body: Record<string, unknown>) => ({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    json: async () => body,
  })

  it.each([
    [
      { code: 'lookup_quota_exceeded', upgrade: true, message: 'Limit' },
      { code: 'lookup_quota_exceeded', upgrade: true },
    ],
    [
      { code: 'lookup_quota_exceeded', message: 'Limit' },
      { code: 'lookup_quota_exceeded' },
    ],
    [{ code: 7, upgrade: 'true', message: 'Limit' }, {}],
    [
      { code: 'too_many_requests', upgrade: false, message: 'Limit' },
      { code: 'too_many_requests' },
    ],
  ])(
    'recordWordLookup exposes the code and upgrade flag of %j',
    async (body, extra) => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce(refusal(body))
      const result = await new ApiService().recordWordLookup('w1')
      expect(result).toEqual({
        success: false,
        error: 'Limit',
        status: 429,
        ...extra,
      })
    }
  )

  it('dictionaryEntries exposes a quota 429 without a transport fallback', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      refusal({
        code: 'lookup_quota_exceeded',
        upgrade: true,
        message: 'Limit',
      })
    )
    const result = await new ApiService().dictionaryEntries('run')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: false,
      error: 'Limit',
      status: 429,
      code: 'lookup_quota_exceeded',
      upgrade: true,
    })
  })
})
