import { emailMatches, isAccountDisabled, isEmailRequired } from '../account'

describe('emailMatches (the deletion confirmation)', () => {
  it.each([
    ['me@example.com', 'me@example.com'],
    ['  Me@Example.COM ', 'me@example.com'],
  ])('accepts %j for %j', (typed, email) => {
    expect(emailMatches(typed, email)).toBe(true)
  })

  it.each([
    ['', 'me@example.com'],
    ['you@example.com', 'me@example.com'],
    ['me@example.co', 'me@example.com'],
    ['', ''],
  ])('refuses %j for %j', (typed, email) => {
    expect(emailMatches(typed, email)).toBe(false)
  })
})

describe('isAccountDisabled', () => {
  it('reads the account_disabled error code', () => {
    expect(isAccountDisabled(403, { code: 'account_disabled' })).toBe(true)
  })

  it('ignores other 403s and other statuses', () => {
    expect(isAccountDisabled(403, { message: 'admin access required' })).toBe(
      false
    )
    expect(isAccountDisabled(400, { code: 'account_disabled' })).toBe(false)
    expect(isAccountDisabled(403, null)).toBe(false)
  })
})

describe('isEmailRequired (ADR-015)', () => {
  it('reads the email_required error code of a 403', () => {
    expect(isEmailRequired(403, { code: 'email_required' })).toBe(true)
  })

  it('ignores other 403s and other statuses', () => {
    expect(isEmailRequired(403, { code: 'account_disabled' })).toBe(false)
    expect(isEmailRequired(403, { message: 'admin access required' })).toBe(
      false
    )
    expect(isEmailRequired(401, { code: 'email_required' })).toBe(false)
    expect(isEmailRequired(403, null)).toBe(false)
  })
})
