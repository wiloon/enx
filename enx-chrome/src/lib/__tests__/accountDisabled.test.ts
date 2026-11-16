import {
  ACCOUNT_DISABLED_MESSAGE,
  EMAIL_REQUIRED_MESSAGE,
  isAccountDisabled,
  isEmailRequired,
} from '../accountDisabled'

describe('isAccountDisabled (ADR-062 Decision 5)', () => {
  it('reads the account_disabled code of a 403', () => {
    expect(isAccountDisabled({ status: 403, code: 'account_disabled' })).toBe(
      true
    )
  })

  it('ignores other 403s and other statuses', () => {
    expect(isAccountDisabled({ status: 403 })).toBe(false)
    expect(isAccountDisabled({ status: 403, code: 'forbidden' })).toBe(false)
    expect(isAccountDisabled({ status: 400, code: 'account_disabled' })).toBe(
      false
    )
    expect(isAccountDisabled({})).toBe(false)
  })

  it('uses the message enx-api and enx-ui show', () => {
    expect(ACCOUNT_DISABLED_MESSAGE).toBe('This account has been disabled.')
  })
})

describe('isEmailRequired (ADR-015)', () => {
  it('reads the email_required code of a 403', () => {
    expect(isEmailRequired({ status: 403, code: 'email_required' })).toBe(true)
  })

  it('ignores other 403s and other statuses', () => {
    expect(isEmailRequired({ status: 403 })).toBe(false)
    expect(isEmailRequired({ status: 403, code: 'account_disabled' })).toBe(
      false
    )
    expect(isEmailRequired({ status: 400, code: 'email_required' })).toBe(false)
    expect(isEmailRequired({})).toBe(false)
  })

  it('uses the message enx-api and enx-ui show', () => {
    expect(EMAIL_REQUIRED_MESSAGE).toBe(
      'Your account has no email address. Contact support to add one.'
    )
  })
})
