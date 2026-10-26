'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { redirectTo } from '@/lib/navigation'
import { apiService, type SubscriptionPlan } from '@/services/api'

const FALLBACK_MESSAGE =
  'Could not open the plan change. Please try again later.'

// Tier-card button that sends a subscribed user to Stripe's plan-change
// confirmation (#424). A blocking subscription conflict also reaches the
// parent through onNeedsSupport, which opens the billing-support form (#297).
// No page mounts it yet.
export default function PlanChangeButton({
  plan,
  onNeedsSupport,
}: {
  plan: SubscriptionPlan
  onNeedsSupport?: (subscriptionId?: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // State lags a click; the ref stops a second one in the same tick.
  const inFlight = useRef(false)

  async function change() {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    let navigating = false
    try {
      const resp = await apiService.createPlanChangeSession(plan)
      const url = resp.data?.url
      if (resp.success && typeof url === 'string' && url !== '') {
        // Stay disabled while the browser leaves the page.
        navigating = true
        redirectTo(url)
        return
      }
      setError((!resp.success && resp.error) || FALLBACK_MESSAGE)
      if (
        !resp.success &&
        resp.status === 409 &&
        resp.reason === 'subscription_conflict'
      ) {
        onNeedsSupport?.(resp.subscriptionId)
      }
    } finally {
      if (!navigating) {
        inFlight.current = false
        setPending(false)
      }
    }
  }

  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        variant="brand"
        onClick={change}
        disabled={pending}
      >
        {pending ? 'Opening…' : 'Change plan'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
