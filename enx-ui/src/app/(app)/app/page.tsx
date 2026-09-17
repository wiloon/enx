'use client'

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'
import { apiService } from '@/services/api'
import ContinueReading from '@/components/app/home/ContinueReading'
import ExtensionBanner from '@/components/app/home/ExtensionBanner'
import OnboardingChecklist from '@/components/app/home/OnboardingChecklist'
import PlanCard from '@/components/app/home/PlanCard'
import QuickTiles from '@/components/app/home/QuickTiles'

// App home (ADR-027): a status-driven workbench, not a directory of features
// -- the sidebar already navigates. Two forms, picked by whether this user
// has anything of their own yet. The today/vocabulary status strip needs
// GET /api/stats/overview (ADR-028) and lands with stage 2.
export default function AppHome() {
  const { user } = useAuth()
  const extensionStatus = useExtensionStatus()

  const {
    data: documents,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['reader-documents'],
    queryFn: async () => {
      const resp = await apiService.listReaderDocuments()
      if (resp.success && resp.data) return resp.data.documents
      throw new Error(resp.error || 'Failed to load documents')
    },
  })

  // Stage-1 stand-in for "has this user done anything yet"; stage 2 switches
  // to overview.vocab.total > 0.
  const hasData = (documents?.length ?? 0) > 0
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
          <ContinueReading
            documents={documents}
            isLoading={isLoading}
            isError={isError}
          />
          <PlanCard />
        </div>
      )}

      <QuickTiles />
      <ExtensionBanner status={extensionStatus} />
    </div>
  )
}
