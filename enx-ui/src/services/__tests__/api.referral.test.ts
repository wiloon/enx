import { ApiService } from '../api'

function jsonResponse(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  }
}

describe('ApiService referral calls (ADR-051)', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('GETs /api/referral/me', async () => {
    const data = {
      code: 'ABCDEFGH',
      link: 'https://catglish.com/invite/ABCDEFGH',
      invited: 1,
      paid: 0,
      pendingRewards: [],
      totalEarned: 0,
    }
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, data))

    expect(await service.getReferralMe()).toEqual({ success: true, data })
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'http://localhost:8090/api/referral/me'
    )
  })

  it('POSTs the code to /api/referral/claim', async () => {
    const data = { bonus: 100, trialExpiresAt: 1760529600 }
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, data))

    expect(await service.claimReferral('ABCDEFGH')).toEqual({
      success: true,
      data,
    })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/referral/claim')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ code: 'ABCDEFGH' })
  })

  it('surfaces a refused claim as a failure', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(409, {
        success: false,
        reason: 'own_code',
        message: "You can't claim your own invite.",
      })
    )
    const result = await service.claimReferral('ABCDEFGH')
    expect(result.success).toBe(false)
    expect(result.error).toBe("You can't claim your own invite.")
    expect(result.status).toBe(409)
  })

  it('carries the status of a failed claim', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(500, { error: 'internal' })
    )
    const result = await service.claimReferral('ABCDEFGH')
    expect(result.success).toBe(false)
    expect(result.status).toBe(500)
  })

  it('has no status when the claim got no answer', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as jest.Mock).mockRejectedValueOnce(
      new TypeError('Failed to fetch')
    )
    const result = await service.claimReferral('ABCDEFGH')
    expect(result.success).toBe(false)
    expect(result.status).toBeUndefined()
  })

  it('GETs /api/referral/offer', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { credits: 200, days: 14 })
    )
    expect(await service.getReferralOffer()).toEqual({
      success: true,
      data: { credits: 200, days: 14 },
    })
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'http://localhost:8090/api/referral/offer'
    )
  })
})
