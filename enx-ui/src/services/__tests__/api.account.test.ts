import { ApiService } from '../api'
import { ACCOUNT_DISABLED_MESSAGE } from '@/lib/account'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  }
}

describe('ApiService account actions (ADR-062)', () => {
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

  it('DELETEs /api/me with the typed email', async () => {
    await service.deleteMyAccount('me@example.com')
    const [url, init] = call()
    expect(url).toBe('http://localhost:8090/api/me')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ email: 'me@example.com' })
  })

  it('surfaces the server message when the deletion is refused', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(
        {
          success: false,
          code: 'subscription_active',
          message: 'Cancel your subscription on the Billing page first.',
        },
        409
      )
    )
    const resp = await service.deleteMyAccount('me@example.com')
    expect(resp.success).toBe(false)
    expect(resp.error).toBe(
      'Cancel your subscription on the Billing page first.'
    )
  })

  it('DELETEs an admin user, with resetTrial only when asked', async () => {
    await service.adminDeleteUser('u/1', { resetTrial: false })
    expect(call()[0]).toBe('http://localhost:8090/api/admin/users/u%2F1')
    expect(call()[1].method).toBe('DELETE')

    await service.adminDeleteUser('u1', { resetTrial: true })
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(
      'http://localhost:8090/api/admin/users/u1?resetTrial=true'
    )
  })

  it.each(['disable', 'enable', 'revoke-sessions'] as const)(
    'POSTs the %s action',
    async (action) => {
      await service.adminUserAction('u1', action)
      const [url, init] = call()
      expect(url).toBe(`http://localhost:8090/api/admin/users/u1/${action}`)
      expect(init.method).toBe('POST')
    }
  )
})

describe('ApiService and a disabled account (ADR-062 Decision 5)', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
  })

  it('reports account_disabled once and returns the message', async () => {
    ;(global.fetch as jest.Mock) = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          code: 'account_disabled',
          message: ACCOUNT_DISABLED_MESSAGE,
        },
        403
      )
    )
    const listener = jest.fn()
    service.onAccountDisabled(listener)

    const resp = await service.getMe()

    expect(resp.success).toBe(false)
    expect(resp.error).toBe(ACCOUNT_DISABLED_MESSAGE)
    expect(service.isAccountDisabled()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not treat another 403 as a disabled account', async () => {
    ;(global.fetch as jest.Mock) = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: false, message: 'admin access required' }, 403)
      )
    await service.getMe()
    expect(service.isAccountDisabled()).toBe(false)
  })

  it('stops calling the server once the account is disabled', async () => {
    ;(global.fetch as jest.Mock) = jest.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          code: 'account_disabled',
          message: ACCOUNT_DISABLED_MESSAGE,
        },
        403
      )
    )
    await service.getMe()
    const resp = await service.getBillingMe()

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(resp.error).toBe(ACCOUNT_DISABLED_MESSAGE)
  })
})
