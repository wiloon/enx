import { deductWarning, parseAdjustment, utcDate } from '../adminUsers'

describe('utcDate', () => {
  it('reads the UTC day of an RFC 3339 time', () => {
    expect(utcDate('2026-10-05T10:07:59.123Z')).toBe('2026-10-05')
  })

  it('shows a dash for a missing time', () => {
    expect(utcDate(null)).toBe('—')
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
    expect(parseAdjustment('grant', '25', '  support comp ')).toEqual({
      ok: true,
      amount: 25,
      reason: 'support comp',
    })
  })

  it.each(['', '0', '-5', '2.5', 'abc', '1e3'])(
    'rejects %p as an amount',
    (amount) => {
      expect(parseAdjustment('grant', amount, 'comp')).toEqual({
        ok: false,
        error: 'Enter a whole number of credits above zero.',
      })
    }
  )

  it('rejects a blank reason', () => {
    expect(parseAdjustment('grant', '10', '   ')).toEqual({
      ok: false,
      error: 'A reason is required.',
    })
  })

  // #1098: one grant may be at most 10,000 credits; deductions are not
  // capped, so a mistaken large grant can still be undone.
  it('accepts a grant of exactly 10,000 credits', () => {
    expect(parseAdjustment('grant', '10000', 'comp')).toEqual({
      ok: true,
      amount: 10000,
      reason: 'comp',
    })
  })

  it('rejects a grant above 10,000 credits', () => {
    expect(parseAdjustment('grant', '10001', 'comp')).toEqual({
      ok: false,
      error: 'A single grant may be at most 10,000 credits.',
    })
  })

  it('accepts a deduction above 10,000 credits', () => {
    expect(parseAdjustment('deduct', '95000000', 'undo a typo')).toEqual({
      ok: true,
      amount: 95000000,
      reason: 'undo a typo',
    })
  })
})
