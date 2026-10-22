import { renderHook } from '@testing-library/react'
import { useAuth } from '../useAuth'

const CLERK_ID = 'user_2abcClerkId'
const signOut = jest.fn()

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
  useUser: () => ({
    user: {
      id: 'user_2abcClerkId',
      fullName: 'Alice Smith',
      username: null,
      primaryEmailAddress: { emailAddress: 'alice@example.com' },
    },
  }),
  useClerk: () => ({ signOut, redirectToSignIn: jest.fn() }),
}))

// The Clerk ID stays inside enx-api; the UI shows and sends the enx user ID
// (#211).
it('does not hand out the Clerk ID', () => {
  const { result } = renderHook(() => useAuth())

  expect(result.current.user).toEqual({
    username: 'Alice Smith',
    email: 'alice@example.com',
    status: 'active',
    isLoggedIn: true,
  })
  expect(JSON.stringify(result.current)).not.toContain(CLERK_ID)
})

it('signs out back to the marketing site', () => {
  const { result } = renderHook(() => useAuth())

  result.current.logout()
  expect(signOut).toHaveBeenCalledWith({ redirectUrl: '/' })
})
