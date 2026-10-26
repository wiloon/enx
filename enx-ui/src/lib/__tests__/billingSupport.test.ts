import {
  BILLING_SUPPORT_FAILED_MESSAGE,
  BILLING_SUPPORT_MAX_LENGTH,
  BILLING_SUPPORT_NEAR_LIMIT,
  parseBillingSupportAnswer,
  supportMessageLength,
  supportMessageStatus,
} from '../billingSupport'

describe('billing support message rule (mirrors conflict.RequestSupport)', () => {
  it('allows exactly 2000 code points and rejects 2001', () => {
    expect(supportMessageStatus('a'.repeat(2000))).toEqual({
      length: 2000,
      blank: false,
      overLimit: false,
    })
    expect(supportMessageStatus('a'.repeat(2001)).overLimit).toBe(true)
  })

  it('counts an emoji as one code point', () => {
    const emoji = '😀'.repeat(2000)
    expect(emoji.length).toBe(4000)
    expect(supportMessageLength(emoji)).toBe(2000)
    expect(supportMessageStatus(emoji).overLimit).toBe(false)
    expect(supportMessageStatus(emoji + '😀').overLimit).toBe(true)
  })

  it('does not count leading and trailing whitespace', () => {
    expect(supportMessageLength('  \n\t' + 'a'.repeat(2000) + ' \n ')).toBe(
      2000
    )
    expect(supportMessageStatus('  \n\t ').blank).toBe(true)
    expect(supportMessageStatus('').blank).toBe(true)
  })

  it('trims U+0085 like Go strings.TrimSpace', () => {
    expect(supportMessageStatus('a'.repeat(2000) + '\u0085').overLimit).toBe(
      false
    )
    expect(supportMessageStatus('\u0085').blank).toBe(true)
  })

  it('keeps U+FEFF like Go strings.TrimSpace', () => {
    expect(supportMessageStatus('a'.repeat(2000) + '\uFEFF').overLimit).toBe(
      true
    )
    expect(supportMessageStatus('\uFEFF').blank).toBe(false)
  })

  it('exposes the limit and the counter threshold', () => {
    expect(BILLING_SUPPORT_MAX_LENGTH).toBe(2000)
    expect(BILLING_SUPPORT_NEAR_LIMIT).toBe(1800)
  })
})

describe('parseBillingSupportAnswer', () => {
  it('reads the stored request out of a 200 body', () => {
    expect(
      parseBillingSupportAnswer({
        success: true,
        message: 'Sent.',
        supportRequest: { message: 'help', sentAt: '2026-10-26T00:00:00Z' },
      })
    ).toEqual({
      message: 'Sent.',
      supportRequest: { message: 'help', sentAt: '2026-10-26T00:00:00Z' },
    })
  })

  it.each([
    ['no supportRequest', { success: true, message: 'Sent.' }],
    ['null body', null],
    [
      'a non-string message',
      { success: true, supportRequest: { message: 1, sentAt: 'x' } },
    ],
    [
      'a missing sentAt',
      { success: true, supportRequest: { message: 'help' } },
    ],
  ])('rejects a body with %s', (_name, body) => {
    expect(parseBillingSupportAnswer(body)).toBeNull()
  })

  it('has fallback copy', () => {
    expect(BILLING_SUPPORT_FAILED_MESSAGE).toBe(
      'Your message could not be sent right now. Please try again later.'
    )
  })
})
