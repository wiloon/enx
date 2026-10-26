import { ApiService } from '../api'
import { UNREACHABLE_MESSAGE } from '@/lib/apiErrors'
import { LEGAL } from '@/lib/legal'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  }
}

describe('ApiService.createPlanChangeSession (#424)', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock) = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, url: 'https://stripe.test/confirm' })
      )
  })

  it('POSTs /api/billing/portal/plan-change with { tier: plan }', async () => {
    await service.createPlanChangeSession('pro-plus')
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/billing/portal/plan-change')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ tier: 'pro-plus' })
    expect(init.headers['Authorization']).toBe('Bearer access-token')
    expect(init.headers['X-Enx-Tz-Offset']).toBeDefined()
  })

  it('returns the URL on a 200', async () => {
    const resp = await service.createPlanChangeSession('max')
    expect(resp.success).toBe(true)
    expect(resp.data?.url).toBe('https://stripe.test/confirm')
  })

  it('keeps a 409 reason, message and subscription id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(
        {
          success: false,
          reason: 'subscription_conflict',
          message: 'Contact support.',
          subscriptionId: 'sub_9',
        },
        409
      )
    )
    const resp = await service.createPlanChangeSession('max')
    expect(resp).toMatchObject({
      success: false,
      status: 409,
      error: 'Contact support.',
      reason: 'subscription_conflict',
      subscriptionId: 'sub_9',
    })
  })

  it('accepts a 409 without a subscription id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(
        { success: false, reason: 'not_a_plan_change', message: 'Same plan.' },
        409
      )
    )
    const resp = await service.createPlanChangeSession('max')
    expect(resp.reason).toBe('not_a_plan_change')
    expect(resp.subscriptionId).toBeUndefined()
  })

  it('ignores a non-string reason and subscription id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(
        {
          success: false,
          reason: 7,
          subscriptionId: { id: 'x' },
          message: 'No.',
        },
        409
      )
    )
    const resp = await service.createPlanChangeSession('max')
    expect(resp.error).toBe('No.')
    expect(resp.reason).toBeUndefined()
    expect(resp.subscriptionId).toBeUndefined()
  })

  it('keeps the reason of a 5xx body next to the normalized error', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({ success: false, reason: 'x', message: 'Down.' }, 503)
    )
    const resp = await service.createPlanChangeSession('max')
    expect(resp.reason).toBe('x')
    expect(resp.error).toBe(
      `Down. If this keeps happening, contact ${LEGAL.contactEmail}.`
    )
  })

  it.each([400, 404])(
    'returns the server message unchanged on %i',
    async (status) => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ success: false, message: 'Bad plan.' }, status)
      )
      const resp = await service.createPlanChangeSession('max')
      expect(resp).toMatchObject({ success: false, error: 'Bad plan.', status })
      expect(resp.reason).toBeUndefined()
    }
  )

  it('returns UNREACHABLE_MESSAGE when fetch rejects', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue(new TypeError('offline'))
    const resp = await service.createPlanChangeSession('max')
    expect(resp).toMatchObject({ success: false, error: UNREACHABLE_MESSAGE })
  })
})
