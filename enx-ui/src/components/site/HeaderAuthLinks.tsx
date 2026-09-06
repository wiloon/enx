'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@clerk/nextjs'
import { SITE } from '@/lib/site'

// Client island (ADR-013 Decision 5): the only auth-aware part of the
// otherwise-static marketing header. Renders a stable label until mounted to
// avoid a hydration mismatch, then swaps in "Open App" for a signed-in viewer.
// Auth state comes from Clerk (ADR-015).
export default function HeaderAuthLinks() {
  const [mounted, setMounted] = useState(false)
  const { isSignedIn } = useAuth()
  useEffect(() => setMounted(true), [])

  const label = mounted && isSignedIn ? 'Open App' : 'Sign in'

  return (
    <Link
      href={SITE.appPath}
      className="text-sm font-medium text-foreground/70 transition-colors hover:text-foreground"
    >
      {label}
    </Link>
  )
}
