import { clerkSubject } from '../subject'
import type { AuthClient } from '@/lib/auth/types'

describe('clerkSubject', () => {
  it('equals the Clerk user.id when a session is present', () => {
    const client: AuthClient = {
      session: { getToken: async () => 'tok' },
      user: { id: 'user_abc' },
    }
    expect(clerkSubject(client)).toBe('user_abc')
  })

  it('is null when there is no session', () => {
    const client: AuthClient = {
      session: null,
      user: { id: 'user_abc' },
    }
    expect(clerkSubject(client)).toBeNull()
  })
})
