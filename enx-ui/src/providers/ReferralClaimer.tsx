'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  createReferralClaimRunner,
  REFERRAL_STORED_EVENT,
} from '@/lib/referral'
import { apiService } from '@/services/api'

// Claims the invite code the /invite/<code> landing page stored, as soon as
// the visitor is signed in (ADR-051 Decision 2), on whatever page that
// happens. Mounted once in the root layout, after ApiAuthBridge so the claim
// carries the session token. The landing page fires REFERRAL_STORED_EVENT
// when a signed-in visitor opens a link, so that claim runs right away.
export default function ReferralClaimer() {
  const { isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const [toast, setToast] = useState<string | null>(null)
  // Outlives effect re-runs, so a sign-in during a claim queues behind it.
  const [runner] = useState(createReferralClaimRunner)

  useEffect(() => {
    if (!isAuthenticated) return
    runner.setContext({
      storage: window.localStorage,
      claim: (code) => apiService.claimReferral(code),
      onBonus: (message) => {
        setToast(message)
        void queryClient.invalidateQueries({ queryKey: ['billing-me'] })
      },
    })
    runner.trigger()
    window.addEventListener(REFERRAL_STORED_EVENT, runner.trigger)
    return () => {
      // No follow-up claim while signed out or unmounted.
      runner.setContext(null)
      window.removeEventListener(REFERRAL_STORED_EVENT, runner.trigger)
    }
  }, [isAuthenticated, queryClient, runner])

  if (!toast) return null
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg"
    >
      <span className="flex-1">{toast}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setToast(null)}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
