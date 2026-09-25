'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { apiService } from '@/services/api'
import { subscriptionStatusLabel } from '@/app/(app)/billing/plans'
import { SITE } from '@/lib/site'
import { tileClass } from './tile'

// Plan + credit balance (ADR-027 decision 10). The remaining free-lookup
// allowance belongs on this card too, but it only becomes computable for
// every user once ADR-029 lands, so it is not rendered yet.
export default function PlanCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['billing-me'],
    queryFn: async () => {
      const resp = await apiService.getBillingMe()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load billing')
    },
  })

  if (isLoading) {
    return (
      <div
        className="h-24 animate-pulse rounded-lg border bg-muted"
        aria-hidden
      />
    )
  }

  // Billing is not load-bearing for Home; if it fails, the card disappears.
  if (isError || !data) return null

  const { subscription, credits } = data
  const total = credits.subscriptionBalance + credits.topupBalance

  return (
    <Link href="/billing" className={tileClass}>
      <span className="flex items-center gap-2 text-sm font-semibold">
        {SITE.name} ·{' '}
        {subscriptionStatusLabel(subscription.status, subscription.plan)}
        <ChevronRight
          aria-hidden
          className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </span>
      <span className="mt-2 text-2xl font-semibold tabular-nums">
        {total.toLocaleString()}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          credits
        </span>
      </span>
      {/* The two pools expire under different rules, so a lone total would
          look like credits vanished when the subscription pool resets. */}
      <span className="mt-1 text-xs text-muted-foreground">
        {credits.subscriptionBalance.toLocaleString()} from plan ·{' '}
        {credits.topupBalance.toLocaleString()} topped up
      </span>
    </Link>
  )
}
