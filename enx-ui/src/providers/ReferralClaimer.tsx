'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { claimStoredReferral, REFERRAL_STORED_EVENT } from '@/lib/referral'
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
  const claiming = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) return
    const claim = async () => {
      if (claiming.current) return
      claiming.current = true
      try {
        const message = await claimStoredReferral(window.localStorage, (code) =>
          apiService.claimReferral(code)
        )
        if (message) {
          setToast(message)
          void queryClient.invalidateQueries({ queryKey: ['billing-me'] })
        }
      } finally {
        claiming.current = false
      }
    }
    void claim()
    window.addEventListener(REFERRAL_STORED_EVENT, claim)
    return () => window.removeEventListener(REFERRAL_STORED_EVENT, claim)
  }, [isAuthenticated, queryClient])

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
