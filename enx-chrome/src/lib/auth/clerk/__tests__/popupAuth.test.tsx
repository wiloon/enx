import { useClerk } from '@clerk/chrome-extension'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useAuthSignOut } from '@/lib/auth'
import { ClerkPopupAuthProvider } from '@/lib/auth/clerk/popupAuth'

jest.mock('@clerk/chrome-extension', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useClerk: jest.fn(),
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: null }),
  useAuth: () => ({ sessionId: 'sess-a' }),
}))

function SignOutConsumer() {
  const signOut = useAuthSignOut()
  return <button onClick={() => void signOut()}>Sign out</button>
}

it('signs out of Clerk with a callback, so Clerk does not reload the popup', () => {
  const signOut = jest.fn(async (..._args: unknown[]) => {})
  const clerk = { signOut }
  jest
    .mocked(useClerk)
    .mockReturnValue(clerk as unknown as ReturnType<typeof useClerk>)
  render(
    <ClerkPopupAuthProvider
      config={{
        provider: 'clerk',
        publishableKey: 'pk_test_x',
        syncHost: 'https://clerk.example',
      }}
    >
      <SignOutConsumer />
    </ClerkPopupAuthProvider>
  )

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

  // A function, not nothing or a redirect URL: Clerk then skips navigate().
  expect(signOut).toHaveBeenCalledTimes(1)
  expect(signOut).toHaveBeenCalledWith(expect.any(Function))
})
