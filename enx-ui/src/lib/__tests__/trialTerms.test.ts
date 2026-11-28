import { loadTrialTerms } from '../trialTerms'

describe('loadTrialTerms', () => {
  it('returns unknown when API_BASE_URL is missing', async () => {
    await expect(
      loadTrialTerms({ baseUrl: '', fetchImpl: jest.fn() })
    ).resolves.toEqual({ status: 'unknown' })
  })

  it('returns unknown when API_BASE_URL is not a valid URL', async () => {
    const fetchImpl = jest.fn()
    await expect(
      loadTrialTerms({ baseUrl: 'not a url', fetchImpl })
    ).resolves.toEqual({ status: 'unknown' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns terms from a successful positive response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ amount: 100, ttl_days: 30 }),
    })

    await expect(
      loadTrialTerms({
        baseUrl: 'http://api.test',
        fetchImpl,
      })
    ).resolves.toEqual({ status: 'terms', amount: 100, ttlDays: 30 })

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/api/billing/trial-terms',
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('returns off when amount is 0', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ amount: 0, ttl_days: 0 }),
    })

    await expect(
      loadTrialTerms({
        baseUrl: 'http://api.test',
        fetchImpl,
      })
    ).resolves.toEqual({ status: 'off' })
  })

  it('returns off when ttl_days is 0 and amount is positive', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ amount: 100, ttl_days: 0 }),
    })

    await expect(
      loadTrialTerms({
        baseUrl: 'http://api.test',
        fetchImpl,
      })
    ).resolves.toEqual({ status: 'off' })
  })

  it('returns unknown on a non-success status', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ amount: 100, ttl_days: 30 }),
    })

    await expect(
      loadTrialTerms({
        baseUrl: 'http://api.test',
        fetchImpl,
      })
    ).resolves.toEqual({ status: 'unknown' })
  })

  it('returns unknown when the body fields are unusable', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ amount: -1, ttl_days: 30 }),
    })

    await expect(
      loadTrialTerms({
        baseUrl: 'http://api.test',
        fetchImpl,
      })
    ).resolves.toEqual({ status: 'unknown' })
  })

  it('returns unknown when the fetch times out', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
    )

    await expect(
      loadTrialTerms({
        baseUrl: 'http://api.test',
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 20,
      })
    ).resolves.toEqual({ status: 'unknown' })
  })
})
