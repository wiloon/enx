import { ACCOUNT_DISABLED_MESSAGE, isAccountDisabled } from '../accountDisabled'

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
