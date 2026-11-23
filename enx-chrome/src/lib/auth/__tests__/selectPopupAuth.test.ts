jest.mock('@/lib/auth/clerk/popupAuth', () => ({
  ClerkPopupAuthProvider: () => null,
}))

import { ClerkPopupAuthProvider } from '@/lib/auth/clerk/popupAuth'
import { selectPopupAuth } from '@/lib/auth/selectPopupAuth'

describe('selectPopupAuth', () => {
  it('selects the Clerk popup adapter for the clerk provider', () => {
    const config = {
      provider: 'clerk' as const,
      publishableKey: 'pk_test_x',
      syncHost: 'https://clerk.example',
    }
    const { Provider } = selectPopupAuth(config)
    expect(Provider({ children: null })).toMatchObject({
      type: ClerkPopupAuthProvider,
      props: { config },
    })
  })
})
