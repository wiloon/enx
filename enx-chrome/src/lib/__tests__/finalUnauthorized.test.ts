import { classifyFinalUnauthorized } from '@/lib/finalUnauthorized'

describe('classifyFinalUnauthorized (#686)', () => {
  it('treats a 401 on a first attempt that had no token as a lost session', () => {
    expect(classifyFinalUnauthorized('none')).toBe('lost')
  })

  it('treats a 401 on a forced replay that had no token as a lost session', () => {
    expect(classifyFinalUnauthorized('without-token')).toBe('lost')
  })

  it('treats a 401 on a forced replay with a freshly minted token as unverified', () => {
    expect(classifyFinalUnauthorized('with-token')).toBe('unverified')
  })
})
