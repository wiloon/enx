'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'
import { apiService } from '@/services/api'
import ExtensionBanner from '@/components/app/home/ExtensionBanner'
import OnboardingChecklist from '@/components/app/home/OnboardingChecklist'
import PlanCard from '@/components/app/home/PlanCard'
import QuickTiles from '@/components/app/home/QuickTiles'
import StatStrip from '@/components/app/home/StatStrip'

// App home (ADR-027): a status-driven workbench, not a directory of features
// -- the sidebar already navigates. Two forms, picked by whether this user
// has anything of their own yet.
//
// The returning user's first block is their own numbers (ADR-028's
// `overview`). It used to be "Continue reading", a list of pasted documents:
// that answered "which file would you like to reopen", which /reader already
// answers better, and it made the reader -- one of several ways in, and not
// the main one -- look like the product.
export default function AppHome() {
  const { user } = useAuth()
  const extensionStatus = useExtensionStatus()

  // Whether this user has done anything yet. The word list is the broadest
  // signal available in one request: it grows from a lookup anywhere -- the
  // extension, /lookup or /reader -- so it says "has read with Catglish",
  // not "has used one particular surface".
  const { data: overview, isLoading, isError } = useQuery({
    queryKey: ['stats-overview'],
    queryFn: async () => {
      const resp = await apiService.getStatsOverview()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load statistics')
    },
  })

  const hasData = (overview?.vocab.total ?? 0) > 0
  const showOnboarding = !isLoading && !isError && !hasData
  const name = user?.username ? `, ${user.username}` : ''

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 md:p-8">
      <h2 className="text-2xl font-bold">
        {hasData ? 'Welcome back' : 'Welcome'}
        {name}!
      </h2>

      {showOnboarding ? (
        <OnboardingChecklist status={extensionStatus} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <StatStrip />
          <PlanCard />
        </div>
      )}

      <QuickTiles />
      <ExtensionBanner status={extensionStatus} />
    </div>
  )
}
