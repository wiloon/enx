'use client'

import { createContext, useContext, type ComponentType } from 'react'
import type { User } from '@/types'

// The provider-neutral auth surface (ADR-036 Decision 3). Each adapter's
// provider fills this context; client code reads it through useAuthContext()
// and never imports a provider SDK.
export type AuthContextValue = {
  isLoaded: boolean
  isSignedIn: boolean
  user: User | null
  signIn: () => unknown
  logout: () => unknown
  getToken: () => Promise<string | null>
  // Renders a redirect to the dedicated sign-in route.
  RedirectToSignIn: ComponentType
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuthContext(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuthContext must be used inside the auth provider')
  }
  return value
}
