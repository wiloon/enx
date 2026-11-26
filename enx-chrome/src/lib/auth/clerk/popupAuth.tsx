import {
  ClerkProvider,
  useAuth,
  useClerk,
  useUser,
} from '@clerk/chrome-extension'
import { useMemo, type ReactNode } from 'react'
import { AuthContext } from '@/lib/auth/context'
import type { ClerkAuthConfig } from '@/lib/auth/config'
import type { AuthUser } from '@/lib/auth/types'

function toAuthUser(user: {
  id: string
  fullName: string | null
  username: string | null
  primaryEmailAddress?: { emailAddress: string } | null
}): AuthUser {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    primaryEmail: user.primaryEmailAddress?.emailAddress ?? null,
  }
}

function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser()
  const { sessionId } = useAuth()
  const clerk = useClerk()

  const value = useMemo(
    () => ({
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      user: isSignedIn && user ? toAuthUser(user) : null,
      sessionId: sessionId ?? null,
      // Passing clerk.signOut() a callback skips navigation that would reload
      // popup.html and force Clerk to start over. The session updates in
      // place and the popup re-renders signed out.
      signOut: () => clerk.signOut(() => {}),
    }),
    [isLoaded, isSignedIn, user, sessionId, clerk]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function ClerkPopupAuthProvider({
  config,
  children,
}: {
  config: ClerkAuthConfig
  children?: ReactNode
}) {
  return (
    <ClerkProvider
      publishableKey={config.publishableKey}
      syncHost={config.syncHost}
      // Pick up a session change on the website without reopening the popup.
      __experimental_syncHostListener
      afterSignOutUrl="/popup.html"
    >
      <ClerkAuthBridge>{children}</ClerkAuthBridge>
    </ClerkProvider>
  )
}
