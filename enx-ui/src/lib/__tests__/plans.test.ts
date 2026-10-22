import {
  hasLiveSubscription,
  subscriptionBadgeVariant,
  subscriptionStatusLabel,
} from '../plans'

describe('hasLiveSubscription', () => {
  it.each(['active', 'trialing', 'past_due', 'incomplete', 'unpaid'])(
    'is true for %s, which Stripe can still bill',
    (status) => {
      expect(hasLiveSubscription(status)).toBe(true)
    }
  )

  it.each(['canceled', 'incomplete_expired', 'none', ''])(
    'is false for %j, which leaves the user free to subscribe',
    (status) => {
      expect(hasLiveSubscription(status)).toBe(false)
    }
  )
})

const FREE_STATUSES = ['none', 'incomplete_expired', 'paused', '', 'mystery']

describe('subscriptionStatusLabel', () => {
  it.each([
    ['pro', 'Pro member'],
    ['pro-plus', 'Pro+ member'],
    ['max', 'Max member'],
  ])('names an active %s subscription after its plan', (plan, label) => {
    expect(subscriptionStatusLabel('active', plan)).toBe(label)
  })

  it.each([undefined, '', 'mystery'])(
    'falls back to Pro for an active subscription with plan %j',
    (plan) => {
      expect(subscriptionStatusLabel('active', plan)).toBe('Pro member')
    }
  )

  it.each([
    ['trialing', 'Subscription starting'],
    ['past_due', 'Subscription past due'],
    ['incomplete', 'Payment incomplete'],
    ['unpaid', 'Subscription unpaid'],
    ['canceled', 'Canceled'],
  ])('labels %s as %j whatever the plan', (status, label) => {
    expect(subscriptionStatusLabel(status, 'max')).toBe(label)
  })

  it.each(FREE_STATUSES)('calls %j a free user', (status) => {
    expect(subscriptionStatusLabel(status, 'pro')).toBe('Free user')
  })
})

describe('subscriptionBadgeVariant', () => {
  it.each([
    ['active', 'brand'],
    ['trialing', 'secondary'],
    ['past_due', 'destructive'],
    ['incomplete', 'destructive'],
    ['unpaid', 'destructive'],
    ['canceled', 'secondary'],
    ...FREE_STATUSES.map((s) => [s, 'secondary']),
  ])('shows %j with the %s badge', (status, variant) => {
    expect(subscriptionBadgeVariant(status)).toBe(variant)
  })
})
