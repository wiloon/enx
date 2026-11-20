'use client'

import { useAuthContext } from '@/auth/context'

// The surface the app consumes: { user, isLoading, isAuthenticated, signIn,
// logout }, derived from the provider-neutral auth context (ADR-036). Session
// tokens, refresh and the OAuth callback are the selected provider's job.
export const useAuth = () => {
  const { isLoaded, isSignedIn, user, signIn, logout } = useAuthContext()

  return {
    user,
    isLoading: !isLoaded,
    isAuthenticated: isSignedIn,
    signIn: () => signIn(),
    logout: () => logout(),
  }
}
