'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useAuth } from '@clerk/nextjs'
import { SITE } from '@/lib/site'

const noopSubscribe = () => () => {}

// Client island (ADR-013 Decision 5): the only auth-aware part of the
// otherwise-static marketing header. Shows a spinner until mounted (avoids a
// hydration mismatch) and Clerk has loaded, so a signed-in viewer never sees a
// "Sign in" that flips to "Go to app →" under the cursor. Auth state comes from
// Clerk (ADR-015).
export default function HeaderAuthLinks() {
  // false during SSR and hydration, true after: the "mounted" flag without a
  // setState-in-effect.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
  const { isLoaded, isSignedIn } = useAuth()

  if (!mounted || !isLoaded) {
    return (
      <span
        role="status"
        aria-label="Checking sign-in status"
        className="inline-flex h-5 w-14 items-center justify-center"
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/70" />
      </span>
    )
  }

  return (
    <Link
      href={SITE.appPath}
      className="whitespace-nowrap text-sm font-medium text-foreground/70 transition-colors hover:text-foreground"
    >
      {isSignedIn ? (
        <>
          Go to app <span aria-hidden="true">→</span>
        </>
      ) : (
        'Sign in'
      )}
    </Link>
  )
}
