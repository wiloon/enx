'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { buttonVariants } from '@/components/ui/button'
import ChromeStoreCta from '@/components/site/ChromeStoreCta'
import { useAuth } from '@/hooks/useAuth'
import {
  REFERRAL_STORED_EVENT,
  offerMessage,
  storeReferralCode,
} from '@/lib/referral'
import { SITE } from '@/lib/site'
import { apiService } from '@/services/api'

// The /invite/<code> landing page (ADR-051 Decision 2 and 8): keeps the code
// for the claim after sign-in (ReferralClaimer makes it) and pitches the
// offer with the numbers the API sends, never hard-coded ones.
export default function InviteLanding({ code }: { code: string }) {
  const { isAuthenticated } = useAuth()

  useEffect(() => {
    storeReferralCode(window.localStorage, code)
    window.dispatchEvent(new Event(REFERRAL_STORED_EVENT))
  }, [code])

  const { data: offer } = useQuery({
    queryKey: ['referral-offer'],
    queryFn: async () => {
      const resp = await apiService.getReferralOffer()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load the offer')
    },
  })

  return (
    <section className="mx-auto max-w-2xl space-y-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        You&apos;re invited to {SITE.name}
      </h1>
      {offer && (
        <p className="text-lg text-muted-foreground">{offerMessage(offer)}</p>
      )}
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        {isAuthenticated ? (
          <Link
            href={SITE.appPath}
            className={buttonVariants({ variant: 'brand', size: 'lg' })}
          >
            Go to app
          </Link>
        ) : (
          <Link
            href="/sign-up"
            className={buttonVariants({ variant: 'brand', size: 'lg' })}
          >
            Sign up
          </Link>
        )}
        <ChromeStoreCta
          className={buttonVariants({ variant: 'outline', size: 'lg' })}
        >
          Install the extension
        </ChromeStoreCta>
      </div>
    </section>
  )
}
