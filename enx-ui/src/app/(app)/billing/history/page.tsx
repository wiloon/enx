'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import PageHeader from '@/components/app/PageHeader'
import CreditTimeline from '@/components/app/CreditTimeline'
import { apiService } from '@/services/api'
import type { CreditDirection } from '@/types'

async function loadPage(before: string, direction: CreditDirection) {
  const resp = await apiService.listCreditTransactions(before, direction)
  if (resp.success && resp.data) return resp.data
  throw new Error(resp.error || 'Failed to load your credit history')
}

// Every credit added to or used from the user's balance (ADR-063), linked
// from the balance card on /billing.
export default function CreditHistoryPage() {
  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6 md:p-8">
      <Link
        href="/billing"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Billing
      </Link>
      <PageHeader
        title="Credit history"
        description="Every credit added to or used from your balance."
      />
      <Card>
        <CardContent>
          <CreditTimeline queryKey={['credit-history']} load={loadPage} />
        </CardContent>
      </Card>
    </div>
  )
}
