import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { AuthContextProvider } from '@/lib/auth/context'

export const harness = {
  subject: 'user-a',
  listeners: new Set<() => void>(),
  selectPopupAuth: null as jest.Mock | null,
}

export function FakeAuthProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    listener => {
      harness.listeners.add(listener)
      return () => harness.listeners.delete(listener)
    },
    () => harness.subject
  )
  const user = useMemo(
    () => ({
      id: snapshot,
      fullName: snapshot,
      username: snapshot,
      primaryEmail: `${snapshot}@example.com`,
    }),
    [snapshot]
  )
  const value = useMemo(
    () => ({
      isLoaded: true,
      isSignedIn: true,
      user,
      sessionId: `sess-${snapshot}`,
      signOut: async () => {},
    }),
    [user, snapshot]
  )
  return <AuthContextProvider value={value}>{children}</AuthContextProvider>
}
