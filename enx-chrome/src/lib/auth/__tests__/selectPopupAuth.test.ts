jest.mock('@clerk/chrome-extension', () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ sessionId: null }),
  useClerk: () => ({ signOut: jest.fn() }),
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
}))

import { selectPopupAuth } from '@/lib/auth/selectPopupAuth'

describe('selectPopupAuth', () => {
  it('selects the Clerk popup adapter for the clerk provider', () => {
    const popup = selectPopupAuth({
      provider: 'clerk',
      publishableKey: 'pk_test_x',
      syncHost: 'https://clerk.example',
    })
    expect(typeof popup.Provider).toBe('function')
  })
})
