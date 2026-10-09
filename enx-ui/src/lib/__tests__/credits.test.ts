import { totalCredits, trialSummary } from '../credits'
import type { BillingCredits } from '@/types'

const NOW = new Date(2026, 9, 8, 12, 0, 0)
const inDays = (days: number) =>
  Math.floor(NOW.getTime() / 1000) + days * 24 * 60 * 60

function credits(over: Partial<BillingCredits> = {}): BillingCredits {
  return {
    subscriptionBalance: 0,
    topupBalance: 0,
    trialBalance: 0,
    trialExpiresAt: null,
    ...over,
  }
}

describe('trialSummary', () => {
  it('names the trial credits and their expiry date', () => {
    expect(
      trialSummary(
        credits({ trialBalance: 100, trialExpiresAt: inDays(7) }),
        NOW
      )
    ).toBe('100 trial credits · expires Oct 15')
  })

  it('is empty for an account that never had a trial', () => {
    expect(trialSummary(credits(), NOW)).toBeNull()
  })

  it('is empty once the trial is spent or expired', () => {
    expect(
      trialSummary(credits({ trialBalance: 0, trialExpiresAt: inDays(3) }), NOW)
    ).toBeNull()
    expect(
      trialSummary(
        credits({ trialBalance: 40, trialExpiresAt: inDays(-1) }),
        NOW
      )
    ).toBeNull()
  })
})

describe('totalCredits', () => {
  it('adds the trial to the paid pools', () => {
    expect(
      totalCredits(
        credits({
          subscriptionBalance: 500,
          topupBalance: 20,
          trialBalance: 100,
        })
      )
    ).toBe(620)
  })
})
