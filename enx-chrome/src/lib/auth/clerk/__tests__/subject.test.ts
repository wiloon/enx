import { clerkSubject } from '../subject'

describe('clerkSubject', () => {
  it('equals the Clerk user.id when a session is present', () => {
    const client = {
      session: {},
      user: { id: 'user_abc' },
    }
    expect(clerkSubject(client)).toBe('user_abc')
  })

  it('is null when there is no session', () => {
    const client = {
      session: null,
      user: { id: 'user_abc' },
    }
    expect(clerkSubject(client)).toBeNull()
  })
})
