'use client'

import {
  RedirectToSignIn,
  useAuth as useClerkAuth,
  useClerk,
  useUser,
} from '@clerk/nextjs'
import { AuthContext, type AuthContextValue } from '../context'

// Fills the provider-neutral auth context from Clerk's hooks (ADR-015).
// Session tokens, refresh and the OAuth callback exchange stay Clerk's job.
export default function ClerkAuthContext({
  children,
}: {
  children: React.ReactNode
}) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth()
  const { user: clerkUser } = useUser()
  const clerk = useClerk()

  const value: AuthContextValue = {
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    user: clerkUser
      ? {
          username:
            clerkUser.fullName ||
            clerkUser.username ||
            clerkUser.primaryEmailAddress?.emailAddress ||
            'user',
          email: clerkUser.primaryEmailAddress?.emailAddress ?? '',
          status: 'active',
          isLoggedIn: true,
        }
      : null,
    signIn: () => clerk.redirectToSignIn(),
    logout: () => clerk.signOut({ redirectUrl: '/' }),
    getToken: () => getToken(),
    RedirectToSignIn,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
