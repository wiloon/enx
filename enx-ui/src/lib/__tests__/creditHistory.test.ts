import type { CreditTransaction } from '@/types'
import {
  balanceText,
  groupTimeline,
  localDate,
  localTime,
  signedCredits,
  supportNote,
  transactionLabel,
} from '../creditHistory'

describe('transactionLabel', () => {
  it.each([
    ['GRANT_SUBSCRIPTION', '', 500, 'Subscription credits'],
    ['GRANT_TOPUP', '', 300, 'Credits purchased'],
    ['GRANT_TRIAL', '', 100, 'Free trial credits'],
    ['GRANT_REFERRAL_BONUS', '', 50, 'Invite bonus (trial credits)'],
    ['GRANT_REFERRAL_REWARD', '', 100, 'Referral reward'],
    ['GRANT_ADMIN', '', 25, 'Credits added by support'],
    ['DEDUCT_ADMIN', '', -10, 'Credits removed by support'],
    ['CLAWBACK', '', -90, 'Credits removed after refund'],
    ['REFUND', 'translate_sentence', 2, 'AI request failed, credits returned'],
    ['EXPIRE', 'trial', -40, 'Trial credits expired'],
    ['EXPIRE', 'subscription', -200, 'Unused subscription credits expired'],
    ['EXPIRE', '', -5, 'Credits expired'],
  ])('calls %s (feature %p) "%s"', (type, feature, amount, label) => {
    expect(transactionLabel({ type, feature, amount })).toEqual({ label })
  })

  describe.each(['SETTLE', 'CONSUME'])('%s by feature', (type) => {
    it.each([
      ['lookup_word_ai', 'AI word lookup'],
      ['translate_word_in_context', 'Word translation'],
      ['translate_sentence', 'Sentence translation'],
      ['translate_sentence_with_word', 'Sentence translation'],
      ['rephrase_to_english', 'Rephrase'],
      ['idiom_notes', 'AI usage'],
      ['', 'AI usage'],
    ])('calls %p "%s"', (feature, label) => {
      expect(transactionLabel({ type, feature, amount: -2 })).toEqual({
        label,
      })
    })
  })

  it.each([
    [40, 'Credits added'],
    [-40, 'Credits removed'],
    [0, 'Balance updated'],
  ])('names an unknown type by the sign of %p: "%s"', (amount, label) => {
    expect(
      transactionLabel({ type: 'GRANT_SOMETHING_NEW', feature: '', amount })
    ).toEqual({ label })
  })

  it('explains a zero subscription grant', () => {
    expect(
      transactionLabel({ type: 'GRANT_SUBSCRIPTION', feature: '', amount: 0 })
    ).toEqual({
      label: 'Subscription payment recorded',
      explanation: 'No credits added',
    })
  })

  it('explains a zero clawback', () => {
    expect(
      transactionLabel({ type: 'CLAWBACK', feature: '', amount: 0 })
    ).toEqual({ label: 'Refund recorded', explanation: 'No credits removed' })
  })
})

describe('signedCredits', () => {
  it.each([
    [25, '+25'],
    [-90, '-90'],
    [0, '+0'],
  ])('writes %p as %p', (n, text) => {
    expect(signedCredits(n)).toBe(text)
  })
})

describe('supportNote', () => {
  it.each(['GRANT_ADMIN', 'DEDUCT_ADMIN'])(
    'prefixes the reason on %s',
    (type) => {
      expect(supportNote({ type, note: 'outage comp' })).toBe(
        'Note from support: outage comp'
      )
    }
  )

  it('is null on other types, whose note is internal', () => {
    expect(supportNote({ type: 'CLAWBACK', note: 'ch_123' })).toBeNull()
  })

  it('is null when support left no note', () => {
    expect(supportNote({ type: 'GRANT_ADMIN', note: '' })).toBeNull()
    expect(supportNote({ type: 'GRANT_ADMIN' })).toBeNull()
  })
})

describe('balanceText', () => {
  it('shows the total balance after the row', () => {
    expect(balanceText(480)).toBe('480')
    expect(balanceText(0)).toBe('0')
  })

  it('shows a dash for an older row without one', () => {
    expect(balanceText(null)).toBe('—')
  })
})

// jest.config.js pins this process to America/Los_Angeles (UTC-8 on these
// dates), so UTC formatting or UTC-day grouping fails here.
describe('browser-local dates and times', () => {
  it('runs in America/Los_Angeles', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      'America/Los_Angeles'
    )
  })

  it('shows 01:30 UTC on Nov 6 as Nov 5 at 17:30 local time', () => {
    expect(localDate('2026-11-06T01:30:00Z')).toBe('Nov 5, 2026')
    expect(localTime('2026-11-06T01:30:00Z')).toBe('17:30')
  })

  it('shows times to the minute', () => {
    expect(localTime('2026-11-05T17:04:59.987Z')).toBe('09:04')
  })
})

function tx(
  createdAt: string,
  overrides: Partial<CreditTransaction> = {}
): CreditTransaction {
  return {
    createdAt,
    type: 'SETTLE',
    feature: 'translate_word_in_context',
    amount: -2,
    totalBalanceAfter: 100,
    ...overrides,
  }
}

describe('groupTimeline', () => {
  it('merges same-day AI spend of one feature at its newest row, with intervening rows below in order', () => {
    const refund = tx('2026-10-19T18:00:00Z', {
      type: 'REFUND',
      amount: 2,
      totalBalanceAfter: 96,
    })
    const topup = tx('2026-10-19T17:00:00Z', {
      type: 'GRANT_TOPUP',
      feature: '',
      amount: 300,
      totalBalanceAfter: 394,
    })
    const rows = [
      tx('2026-10-19T19:00:00Z', { totalBalanceAfter: 90 }),
      refund,
      tx('2026-10-19T17:30:00Z', { totalBalanceAfter: 94 }),
      topup,
      tx('2026-10-19T16:00:00Z', { amount: -3, totalBalanceAfter: 94 }),
    ]

    const items = groupTimeline(rows)

    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({
      kind: 'group',
      feature: 'translate_word_in_context',
      rows: [rows[0], rows[2], rows[4]],
      count: 3,
      amount: -7,
      totalBalanceAfter: 90,
    })
    expect(items[1]).toEqual({ kind: 'row', row: refund })
    expect(items[2]).toEqual({ kind: 'row', row: topup })
  })

  it('merges a group across a page boundary once the next page is loaded', () => {
    const page1 = [
      tx('2026-10-19T19:00:00Z', { totalBalanceAfter: 90 }),
      tx('2026-10-19T18:00:00Z', { type: 'GRANT_ADMIN', amount: 5 }),
    ]
    const page2 = [
      tx('2026-10-19T17:00:00Z', { type: 'CONSUME', amount: -4 }),
      tx('2026-10-18T17:00:00Z'),
    ]

    const items = groupTimeline([...page1, ...page2])

    expect(items.map((i) => i.kind)).toEqual(['group', 'row', 'row'])
    expect(items[0]).toMatchObject({
      rows: [page1[0], page2[0]],
      count: 2,
      amount: -6,
      totalBalanceAfter: 90,
    })
    expect(items[2]).toEqual({ kind: 'row', row: page2[1] })
  })

  it('keeps distinct feature codes apart even when their labels match', () => {
    const rows = [
      tx('2026-10-19T19:00:00Z', { feature: 'translate_sentence' }),
      tx('2026-10-19T18:00:00Z', { feature: 'translate_sentence_with_word' }),
      tx('2026-10-19T17:00:00Z', { feature: 'translate_sentence' }),
      tx('2026-10-19T16:00:00Z', { feature: 'translate_sentence_with_word' }),
    ]

    const items = groupTimeline(rows)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      feature: 'translate_sentence',
      rows: [rows[0], rows[2]],
    })
    expect(items[1]).toMatchObject({
      feature: 'translate_sentence_with_word',
      rows: [rows[1], rows[3]],
    })
  })

  it('never groups REFUND or other types', () => {
    const rows = [
      tx('2026-10-19T19:00:00Z', { type: 'REFUND', amount: 2 }),
      tx('2026-10-19T18:00:00Z', { type: 'REFUND', amount: 2 }),
    ]

    expect(groupTimeline(rows)).toEqual([
      { kind: 'row', row: rows[0] },
      { kind: 'row', row: rows[1] },
    ])
  })

  it('leaves a lone AI row as a row', () => {
    const rows = [tx('2026-10-19T19:00:00Z')]
    expect(groupTimeline(rows)).toEqual([{ kind: 'row', row: rows[0] }])
  })

  it('groups by the local calendar day, not the UTC one', () => {
    // Nov 6 02:00, Nov 5 17:30 and Nov 5 12:00 in Los Angeles.
    const nov6 = tx('2026-11-06T10:00:00Z')
    const nov5Evening = tx('2026-11-06T01:30:00Z')
    const nov5Noon = tx('2026-11-05T20:00:00Z')

    const items = groupTimeline([nov6, nov5Evening, nov5Noon])

    expect(items).toEqual([
      { kind: 'row', row: nov6 },
      expect.objectContaining({
        kind: 'group',
        rows: [nov5Evening, nov5Noon],
      }),
    ])
  })
})
