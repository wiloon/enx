import {
  deductWarning,
  ledgerEntryLabel,
  parseAdjustment,
  signedCredits,
  utcDate,
  utcMinute,
} from '../adminUsers'

describe('signedCredits', () => {
  it.each([
    [25, '+25'],
    [-90, '-90'],
    [0, '0'],
  ])('writes %p as %p', (n, text) => {
    expect(signedCredits(n)).toBe(text)
  })
})

describe('utcDate and utcMinute', () => {
  it('reads the UTC day and minute of an RFC 3339 time', () => {
    expect(utcDate('2026-10-05T10:07:59.123Z')).toBe('2026-10-05')
    expect(utcMinute('2026-10-05T10:07:59.123Z')).toBe('2026-10-05 10:07 UTC')
  })

  it('shows a dash for a missing time', () => {
    expect(utcDate(null)).toBe('—')
  })
})

describe('ledgerEntryLabel', () => {
  it.each([
    ['GRANT_SUBSCRIPTION', 'Subscription credits'],
    ['GRANT_TOPUP', 'Top-up purchase'],
    ['GRANT_TRIAL', 'Sign-up trial'],
    ['GRANT_ADMIN', 'Admin grant'],
    ['DEDUCT_ADMIN', 'Admin deduction'],
    ['CLAWBACK', 'Refund clawback'],
    ['SETTLE', 'AI usage'],
    ['CONSUME', 'AI usage'],
    ['REFUND', 'AI usage refund'],
  ])('calls %s "%s"', (type, label) => {
    expect(ledgerEntryLabel(type)).toBe(label)
  })

  it('shows an unknown type as it is', () => {
    expect(ledgerEntryLabel('GRANT_REFERRAL')).toBe('GRANT_REFERRAL')
  })
})

// ADR-049 Decision 3: a deduction comes out of the top-up pool only, and
// that pool may go negative.
describe('deductWarning', () => {
  it('is null while the top-up pool covers the deduction', () => {
    expect(deductWarning(50, 50)).toBeNull()
  })

  it('names the negative top-up balance the deduction would leave', () => {
    expect(deductWarning(20, 50)).toBe(
      'This leaves the top-up balance at -30 credits.'
    )
  })

  it('counts from a top-up pool that is already negative', () => {
    expect(deductWarning(-10, 5)).toBe(
      'This leaves the top-up balance at -15 credits.'
    )
  })
})

describe('parseAdjustment', () => {
  it('accepts a positive whole amount and a reason, trimming the reason', () => {
    expect(parseAdjustment('25', '  support comp ')).toEqual({
      ok: true,
      amount: 25,
      reason: 'support comp',
    })
  })

  it.each(['', '0', '-5', '2.5', 'abc', '1e3'])(
    'rejects %p as an amount',
    (amount) => {
      expect(parseAdjustment(amount, 'comp')).toEqual({
        ok: false,
        error: 'Enter a whole number of credits above zero.',
      })
    }
  )

  it('rejects a blank reason', () => {
    expect(parseAdjustment('10', '   ')).toEqual({
      ok: false,
      error: 'A reason is required.',
    })
  })
})
