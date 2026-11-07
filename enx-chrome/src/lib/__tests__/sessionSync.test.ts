import { classifySessionSync, outcomeWithoutToken } from '../sessionSync'

describe('classifySessionSync (#688)', () => {
  it('is present when the loaded client holds a session', () => {
    expect(
      classifySessionSync({
        loaded: true,
        hasSession: true,
        signedOutReadSucceeded: false,
      })
    ).toBe('present')
  })

  it('is absent when a read of the client succeeded and held no session', () => {
    expect(
      classifySessionSync({
        loaded: true,
        hasSession: false,
        signedOutReadSucceeded: true,
      })
    ).toBe('absent')
  })

  it('is unconfirmed when the load came back empty but no read succeeded', () => {
    expect(
      classifySessionSync({
        loaded: true,
        hasSession: false,
        signedOutReadSucceeded: false,
      })
    ).toBe('unconfirmed')
  })

  it('is unconfirmed when the load itself failed', () => {
    expect(classifySessionSync({ loaded: false })).toBe('unconfirmed')
  })
})

describe('outcomeWithoutToken (#688)', () => {
  it('ends the session only when Clerk confirmed it is gone', () => {
    expect(outcomeWithoutToken('absent')).toBe('session-loss')
  })

  it.each(['unconfirmed', 'present'] as const)(
    'is a transient failure when the sync is %s',
    sync => {
      expect(outcomeWithoutToken(sync)).toBe('transient')
    }
  )
})
