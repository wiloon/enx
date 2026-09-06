'use client'

import { RedirectToSignIn } from '@clerk/nextjs'
import { useAuth } from '@/hooks/useAuth'
import AppShell from '@/components/app/AppShell'

// Shared shell + auth gate for the whole app area (ADR-016): /app, /lookup,
// /rephrase, /billing, /stats. The marketing pages at "/" stay outside this
// group and unauthenticated.
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isAuthenticated, isLoading } = useAuth()

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

  return <AppShell>{children}</AppShell>
}
