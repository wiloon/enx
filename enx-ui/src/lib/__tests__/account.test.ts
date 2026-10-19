import { emailMatches, isAccountDisabled } from '../account'

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
