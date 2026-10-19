'use client'

import { RedirectToSignIn } from '@clerk/nextjs'
import { useAuth } from '@/hooks/useAuth'
import { useAccountDisabled } from '@/hooks/useAccountDisabled'
import AppShell from '@/components/app/AppShell'
import { Button } from '@/components/ui/button'
import { ACCOUNT_DISABLED_MESSAGE } from '@/lib/account'

// Shared shell + auth gate for the whole app area (ADR-016): /app, /lookup,
// /rephrase, /billing, /stats. The marketing pages at "/" stay outside this
// group and unauthenticated.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, logout } = useAuth()
  const accountDisabled = useAccountDisabled()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    // Redirect to the dedicated /sign-in route — mounting Clerk's <SignIn>
    // inline here breaks its /sso-callback derivation (ADR-015,
    // src/__tests__/clerk-routing.test.ts).
    return <RedirectToSignIn />
  }

  // ADR-062 Decision 5: enx-api refuses every request of a disabled
  // account, so the pages would only show errors (and nothing retries).
  if (accountDisabled) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <p role="alert" className="text-lg font-medium">
            {ACCOUNT_DISABLED_MESSAGE}
          </p>
          <Button variant="outline" onClick={() => logout()}>
            Sign out
          </Button>
        </div>
      </div>
    )
  }

  return <AppShell>{children}</AppShell>
}
