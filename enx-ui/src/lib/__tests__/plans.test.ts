import { hasLiveSubscription } from '../plans'

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
