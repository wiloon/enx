import {
  loadFreeDailyLookupLimit,
  usableFreeDailyLookupLimit,
} from '../freeDailyLookupLimit'

describe('usableFreeDailyLookupLimit', () => {
  it.each([1, 2345, Number.MAX_SAFE_INTEGER])(
    'accepts positive safe integer %p',
    (n) => {
      expect(usableFreeDailyLookupLimit(n)).toBe(true)
    }
  )

  it.each([0, -1, 1.5, NaN, Infinity, '2345', null, undefined, {}])(
    'rejects unusable value %p',
    (v) => {
      expect(usableFreeDailyLookupLimit(v)).toBe(false)
    }
  )
})

describe('loadFreeDailyLookupLimit', () => {
  it('returns null when API_BASE_URL is missing', async () => {
    await expect(
      loadFreeDailyLookupLimit({ baseUrl: '', fetchImpl: jest.fn() })
    ).resolves.toBeNull()
  })

  it('returns null when API_BASE_URL is not a valid URL', async () => {
    const fetchImpl = jest.fn()
    await expect(
      loadFreeDailyLookupLimit({ baseUrl: 'not a url', fetchImpl })
    ).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns a usable free limit from a successful response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ free_daily_lookup_limit: 2345 }),
    })

    await expect(
      loadFreeDailyLookupLimit({
        baseUrl: 'http://api.test',
        fetchImpl,
      })
    ).resolves.toBe(2345)

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/api/dictionary/free-daily-lookup-limit',
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('returns null on a non-success status', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ free_daily_lookup_limit: 2345 }),
    })

    await expect(
      loadFreeDailyLookupLimit({
        baseUrl: 'http://api.test',
        fetchImpl,
      })
    ).resolves.toBeNull()
  })

  it('returns null when the response limit is unusable', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ free_daily_lookup_limit: 0 }),
    })

    await expect(
      loadFreeDailyLookupLimit({
        baseUrl: 'http://api.test',
        fetchImpl,
      })
    ).resolves.toBeNull()
  })

  it('returns null when the fetch times out', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
    )

    await expect(
      loadFreeDailyLookupLimit({
        baseUrl: 'http://api.test',
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 20,
      })
    ).resolves.toBeNull()
  })
})
