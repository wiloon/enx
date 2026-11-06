import { ApiService } from '../api'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body }
}

describe('ApiService credit history (ADR-063)', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock) = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }))
  })

  const url = () => (global.fetch as jest.Mock).mock.calls[0][0]

  it('GETs the first page of every row', async () => {
    await service.listCreditTransactions('', '')
    expect(url()).toBe(
      'http://localhost:8090/api/me/credits/transactions?limit=50'
    )
  })

  it('GETs a later page of added rows from the previous cursor', async () => {
    await service.listCreditTransactions('1760000000000_42', 'in')
    expect(url()).toBe(
      'http://localhost:8090/api/me/credits/transactions?limit=50&before=1760000000000_42&direction=in'
    )
  })
})
