import {
  ClerkProvider,
  useAuth,
  useClerk,
  useUser,
} from '@clerk/chrome-extension'
import { useMemo, type ReactNode } from 'react'
import { AuthContextProvider } from '@/lib/auth/context'
import type { ClerkAuthConfig } from '@/lib/auth/config'
import type { AuthUser, PopupAuthAdapter } from '@/lib/auth/types'

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
      signOut: (callback?: () => void) => clerk.signOut(callback),
    }),
    [isLoaded, isSignedIn, user, sessionId, clerk]
  )

  return <AuthContextProvider value={value}>{children}</AuthContextProvider>
}

export function createClerkPopupAuth(
  config: ClerkAuthConfig
): PopupAuthAdapter {
  return {
    Provider({ children }) {
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
    },
  }
}
