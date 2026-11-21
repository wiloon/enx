import { createContext, useContext } from 'react'
import type { AuthSessionView } from '@/lib/auth/types'

export type AuthContextValue = AuthSessionView & {
  signOut: (callback?: () => void) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuthSession(): AuthSessionView {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error(
      'useAuthSession must be used within the selected auth Provider'
    )
  }
  return value
}

export function useAuthSignOut(): (callback?: () => void) => Promise<void> {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error(
      'useAuthSignOut must be used within the selected auth Provider'
    )
  }
  return value.signOut
}
