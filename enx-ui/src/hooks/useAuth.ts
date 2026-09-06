'use client'

import { useAuth as useClerkAuth, useClerk, useUser } from '@clerk/nextjs'
import { User } from '@/types'

// Thin adapter over Clerk (ADR-015) that keeps the surface the app already
// consumes: { user, isLoading, isAuthenticated, signIn, logout }. Session
// tokens, refresh, and the /auth/callback exchange are all Clerk's job now.
export const useAuth = () => {
  const { isLoaded, isSignedIn } = useClerkAuth()
  const { user: clerkUser } = useUser()
  const clerk = useClerk()

  const user: User | null = clerkUser
    ? {
        id: clerkUser.id,
        username:
          clerkUser.fullName ||
          clerkUser.username ||
          clerkUser.primaryEmailAddress?.emailAddress ||
          'user',
        email: clerkUser.primaryEmailAddress?.emailAddress ?? '',
        status: 'active',
        isLoggedIn: true,
      }
    : null

  return {
    user,
    isLoading: !isLoaded,
    isAuthenticated: Boolean(isSignedIn),
    signIn: () => clerk.redirectToSignIn(),
    logout: () => clerk.signOut({ redirectUrl: '/' }),
  }
}
