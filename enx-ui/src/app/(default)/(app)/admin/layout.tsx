'use client'

import { notFound } from 'next/navigation'
import { useIsAdmin } from '@/hooks/useIsAdmin'

// Admin-only subtree (ADR-021). Nested inside (app)/layout.tsx, so the login
// gate + AppShell already apply; this adds the role check on top. A non-admin
// gets a 404 rather than a hint that /admin exists. This is only "don't show
// the door" — every admin endpoint is enforced by enx-api's RequireAdmin.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isAdmin, isLoading } = useIsAdmin()

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
      </div>
    )
  }

  if (!isAdmin) {
    notFound()
  }

  return <>{children}</>
}
