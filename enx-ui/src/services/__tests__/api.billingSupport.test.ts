import { ApiService } from '../api'
import { BILLING_SUPPORT_FAILED_MESSAGE } from '@/lib/billingSupport'
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

const stored = {
  success: true,
  message: 'Your message was sent to support.',
  supportRequest: { message: 'help me', sentAt: '2026-10-26T00:00:00Z' },
}

describe('ApiService.submitBillingSupport (#421)', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock) = jest
      .fn()
      .mockResolvedValue(jsonResponse(stored))
  })

  it('POSTs /api/billing/support with the subscription id and message', async () => {
    await service.submitBillingSupport('sub_1', 'help me')
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/billing/support')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      subscriptionId: 'sub_1',
      message: 'help me',
    })
  })

  it('returns the stored request on a 200', async () => {
    const resp = await service.submitBillingSupport('sub_1', 'help me')
    expect(resp.success).toBe(true)
    expect(resp.data).toEqual({
      message: stored.message,
      supportRequest: stored.supportRequest,
    })
  })

  it.each([400, 404])(
    'returns the server message unchanged on %i',
    async (status) => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse(
          { success: false, message: 'Write a message first.' },
          status
        )
      )
      const resp = await service.submitBillingSupport('sub_1', ' ')
      expect(resp.success).toBe(false)
      expect(resp.error).toBe('Write a message first.')
    }
  )

  it('adds the support hint to the server message on 503', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(
        {
          success: false,
          message:
            'Your message could not be sent right now. Please try again later.',
        },
        503
      )
    )
    const resp = await service.submitBillingSupport('sub_1', 'help me')
    expect(resp.error).toBe(
      `Your message could not be sent right now. Please try again later. If this keeps happening, contact ${LEGAL.contactEmail}.`
    )
  })

  it('returns UNREACHABLE_MESSAGE when fetch rejects', async () => {
    ;(global.fetch as jest.Mock).mockRejectedValue(new TypeError('offline'))
    const resp = await service.submitBillingSupport('sub_1', 'help me')
    expect(resp).toMatchObject({ success: false, error: UNREACHABLE_MESSAGE })
  })

  it.each([
    ['no supportRequest', { success: true, message: 'Sent.' }],
    [
      'a non-string sentAt',
      { success: true, supportRequest: { message: 'x', sentAt: 5 } },
    ],
  ])('treats a 200 with %s as a failure', async (_name, body) => {
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(body))
    const resp = await service.submitBillingSupport('sub_1', 'help me')
    expect(resp.success).toBe(false)
    expect(resp.error).toBe(BILLING_SUPPORT_FAILED_MESSAGE)
  })
})
