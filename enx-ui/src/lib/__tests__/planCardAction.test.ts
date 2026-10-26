import { planCardAction } from '../plans'

describe('planCardAction (#424)', () => {
  it.each(['none', 'canceled', 'incomplete_expired', ''])(
    'offers subscribe when the status %p is not live',
    (status) => {
      expect(planCardAction(status, 'pro', 'pro')).toBe('subscribe')
      expect(planCardAction(status, 'pro', 'max')).toBe('subscribe')
    }
  )

  it('gives no button on the current tier of an active subscription', () => {
    expect(planCardAction('active', 'pro', 'pro')).toBe('current')
  })

  it('offers a change on another tier of an active subscription', () => {
    expect(planCardAction('active', 'pro', 'max')).toBe('change')
  })

  it.each(['', 'enterprise'])(
    'offers a change on every card when the active plan is %p',
    (plan) => {
      expect(planCardAction('active', plan, 'pro')).toBe('change')
      expect(planCardAction('active', plan, 'pro-plus')).toBe('change')
      expect(planCardAction('active', plan, 'max')).toBe('change')
    }
  )

  it.each(['past_due', 'unpaid', 'incomplete', 'trialing'])(
    'sends %s to the portal home on its own tier and on another',
    (status) => {
      expect(planCardAction(status, 'pro', 'pro')).toBe('portal_home')
      expect(planCardAction(status, 'pro', 'max')).toBe('portal_home')
    }
  )
})
