import { resolveAuthProvider } from '../authProvider'

describe('resolveAuthProvider (ADR-036 Decision 3)', () => {
  it('selects Clerk when AUTH_PROVIDER is unset', () => {
    expect(resolveAuthProvider(undefined)).toBe('clerk')
  })

  it('selects Clerk for the exact value "clerk"', () => {
    expect(resolveAuthProvider('clerk')).toBe('clerk')
  })

  it.each([
    ['logto', 'logto'],
    ['an unknown value', 'okta'],
    ['an empty string', ''],
    ['whitespace', '  '],
    ['a different case', 'Clerk'],
  ])('rejects %s with a diagnostic naming AUTH_PROVIDER', (_name, value) => {
    expect(() => resolveAuthProvider(value)).toThrow(/AUTH_PROVIDER/)
    expect(() => resolveAuthProvider(value)).toThrow(/"clerk"/)
  })
})
