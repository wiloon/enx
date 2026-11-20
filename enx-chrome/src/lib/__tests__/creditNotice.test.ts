import { creditNotice, type BillingInputs } from '@/lib/creditNotice'

const NOW = new Date('2026-06-15T12:00:00Z')

function billing(partial: Partial<BillingInputs>): BillingInputs {
  return {
    subscriptionBalance: 0,
    topupBalance: 0,
    trialBalance: 0,
    trialExpiresAt: null,
    subscriptionStatus: 'none',
    lowBalanceThreshold: 20,
    ...partial,
  }
}

describe('creditNotice', () => {
  it('shows trial expiry in N hours when under 24h remain (ceil, min 1)', () => {
    const expires = new Date(NOW.getTime() + 90 * 60 * 1000) // 1.5h
    expect(
      creditNotice(
        billing({
          trialBalance: 10,
          trialExpiresAt: Math.floor(expires.getTime() / 1000),
        }),
        NOW
      )
    ).toEqual({ text: 'Trial credits expire in 2 hours', href: '/billing' })
  })

  it('uses singular hour when N is 1', () => {
    const expires = new Date(NOW.getTime() + 30 * 60 * 1000)
    expect(
      creditNotice(
        billing({
          trialBalance: 5,
          trialExpiresAt: Math.floor(expires.getTime() / 1000),
        }),
        NOW
      )
    ).toEqual({ text: 'Trial credits expire in 1 hour', href: '/billing' })
  })

  it('says tomorrow when 24h ≤ remaining ≤ 48h', () => {
    const expires = new Date(NOW.getTime() + 36 * 60 * 60 * 1000)
    expect(
      creditNotice(
        billing({
          trialBalance: 10,
          trialExpiresAt: Math.floor(expires.getTime() / 1000),
        }),
        NOW
      )
    ).toEqual({ text: 'Trial credits expire tomorrow', href: '/billing' })
  })

  it('shows trial expiry at exactly 48h', () => {
    const expires = new Date(NOW.getTime() + 48 * 60 * 60 * 1000)
    expect(
      creditNotice(
        billing({
          trialBalance: 10,
          trialExpiresAt: Math.floor(expires.getTime() / 1000),
        }),
        NOW
      )
    ).toEqual({ text: 'Trial credits expire tomorrow', href: '/billing' })
  })

  it('shows no trial-expiry notice past 48h', () => {
    const expires = new Date(NOW.getTime() + 49 * 60 * 60 * 1000)
    expect(
      creditNotice(
        billing({
          trialBalance: 10,
          trialExpiresAt: Math.floor(expires.getTime() / 1000),
          lowBalanceThreshold: 0,
        }),
        NOW
      )
    ).toBeNull()
  })

  it('shows no notice at the expiry instant (trial treated as 0)', () => {
    const expiresUnix = Math.floor(NOW.getTime() / 1000)
    expect(
      creditNotice(
        billing({
          trialBalance: 10,
          trialExpiresAt: expiresUnix,
        }),
        NOW
      )
    ).toBeNull()
  })

  it('prefers trial expiry over low balance when both match', () => {
    const expires = new Date(NOW.getTime() + 12 * 60 * 60 * 1000)
    expect(
      creditNotice(
        billing({
          trialBalance: 10,
          trialExpiresAt: Math.floor(expires.getTime() / 1000),
          lowBalanceThreshold: 20,
        }),
        NOW
      )
    ).toEqual({
      text: 'Trial credits expire in 12 hours',
      href: '/billing',
    })
  })

  it('still shows trial expiry when threshold is 0', () => {
    const expires = new Date(NOW.getTime() + 12 * 60 * 60 * 1000)
    expect(
      creditNotice(
        billing({
          trialBalance: 10,
          trialExpiresAt: Math.floor(expires.getTime() / 1000),
          lowBalanceThreshold: 0,
        }),
        NOW
      )
    ).toEqual({
      text: 'Trial credits expire in 12 hours',
      href: '/billing',
    })
  })

  it('ignores trial expiry when subscription or top-up pool is non-zero', () => {
    const expires = new Date(NOW.getTime() + 12 * 60 * 60 * 1000)
    expect(
      creditNotice(
        billing({
          subscriptionBalance: 5,
          trialBalance: 10,
          trialExpiresAt: Math.floor(expires.getTime() / 1000),
          lowBalanceThreshold: 20,
        }),
        NOW
      )
    ).toEqual({ text: 'Only 15 AI credits left · Get more', href: '/billing' })
  })

  it('tells an active subscriber they are out of credits', () => {
    expect(
      creditNotice(
        billing({
          subscriptionStatus: 'active',
          subscriptionBalance: 0,
          topupBalance: 0,
          trialBalance: 0,
        }),
        NOW
      )
    ).toEqual({ text: 'Out of AI credits · Get more', href: '/billing' })
  })

  it('tells a past_due subscriber with a negative balance they are out', () => {
    expect(
      creditNotice(
        billing({
          subscriptionStatus: 'past_due',
          subscriptionBalance: -3,
          topupBalance: 0,
          trialBalance: 0,
        }),
        NOW
      )
    ).toEqual({ text: 'Out of AI credits · Get more', href: '/billing' })
  })

  it('shows low balance when 0 < B ≤ threshold', () => {
    expect(
      creditNotice(
        billing({
          topupBalance: 12,
          lowBalanceThreshold: 20,
        }),
        NOW
      )
    ).toEqual({ text: 'Only 12 AI credits left · Get more', href: '/billing' })
  })

  it('shows no low-balance notice when threshold is 0', () => {
    expect(
      creditNotice(
        billing({
          topupBalance: 12,
          lowBalanceThreshold: 0,
        }),
        NOW
      )
    ).toBeNull()
  })

  it('falls back to threshold 20 when the API omits lowBalanceThreshold', () => {
    const input = billing({ topupBalance: 15 })
    delete (input as { lowBalanceThreshold?: number }).lowBalanceThreshold
    expect(creditNotice(input, NOW)).toEqual({
      text: 'Only 15 AI credits left · Get more',
      href: '/billing',
    })
  })

  it('shows no notice when the balance is fine', () => {
    expect(
      creditNotice(
        billing({
          subscriptionBalance: 100,
          subscriptionStatus: 'active',
        }),
        NOW
      )
    ).toBeNull()
  })

  it('shows no notice for a free user with B ≤ 0', () => {
    expect(
      creditNotice(
        billing({
          subscriptionStatus: 'none',
          subscriptionBalance: 0,
          topupBalance: 0,
          trialBalance: 0,
        }),
        NOW
      )
    ).toBeNull()
  })

  it('shows no notice for a free user with 10 trial credits past expiry', () => {
    const expired = Math.floor(NOW.getTime() / 1000) - 60
    expect(
      creditNotice(
        billing({
          subscriptionStatus: 'none',
          trialBalance: 10,
          trialExpiresAt: expired,
          lowBalanceThreshold: 20,
        }),
        NOW
      )
    ).toBeNull()
  })
})
