import { ApiService } from '../api'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body }
}

describe('ApiService admin users (ADR-049)', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock) = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }))
  })

  const call = () => (global.fetch as jest.Mock).mock.calls[0]

  it('GETs the users list with the search, sort and paging', async () => {
    await service.adminListUsers({
      q: 'a+b@x',
      sort: 'balance',
      limit: 50,
      offset: 100,
    })
    expect(call()[0]).toBe(
      'http://localhost:8090/api/admin/users?q=a%2Bb%40x&sort=balance&limit=50&offset=100'
    )
  })

  it('GETs one user, encoded', async () => {
    await service.adminGetUser('u/1')
    expect(call()[0]).toBe('http://localhost:8090/api/admin/users/u%2F1')
  })

  it('GETs the first ledger page without a cursor', async () => {
    await service.adminListUserTransactions('u1', '')
    expect(call()[0]).toBe(
      'http://localhost:8090/api/admin/users/u1/transactions?limit=50'
    )
  })

  it('GETs a later ledger page from the previous cursor', async () => {
    await service.adminListUserTransactions('u1', '1760000000000_42')
    expect(call()[0]).toBe(
      'http://localhost:8090/api/admin/users/u1/transactions?limit=50&before=1760000000000_42'
    )
  })

  it.each(['grant', 'deduct'] as const)(
    'POSTs a %s with the email, amount and reason',
    async (direction) => {
      await service.adminAdjustCredits(direction, {
        email: 'a@example.com',
        amount: 25,
        reason: 'support comp',
      })
      const [url, init] = call()
      expect(url).toBe(`http://localhost:8090/api/admin/credits/${direction}`)
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({
        email: 'a@example.com',
        amount: 25,
        reason: 'support comp',
      })
    }
  )
})
