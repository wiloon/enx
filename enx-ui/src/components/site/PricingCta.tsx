'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useAuth } from '@clerk/nextjs'

const noopSubscribe = () => () => {}

// Checkout needs to know whose account the credits go to, so the public
// /pricing page never starts one itself: a visitor signs up first and lands
// on /billing, where the real Subscribe / Buy buttons are. Same client-island
// pattern as HeaderAuthLinks -- a stable signed-out link until mounted.
export function pricingCtaHref(signedIn: boolean): string {
  return signedIn ? '/billing' : '/sign-up?redirect_url=%2Fbilling'
}

export default function PricingCta({
  label,
  variant = 'primary',
}: {
  label: string
  variant?: 'primary' | 'outline'
}) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  )
  const { isSignedIn } = useAuth()

  const className =
    variant === 'primary'
      ? 'w-full rounded-md bg-brand px-4 py-2 text-center text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90'
      : 'w-full rounded-md border border-border px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-muted'

  return (
    <Link
      href={pricingCtaHref(mounted && Boolean(isSignedIn))}
      className={className}
    >
      {label}
    </Link>
  )
}
