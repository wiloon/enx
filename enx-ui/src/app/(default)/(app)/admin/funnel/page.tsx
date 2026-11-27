'use client'

import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/app/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { unwrap } from '@/lib/apiResult'
import { FUNNEL_STEPS, shareOfSignUps } from '@/lib/funnel'
import { apiService } from '@/services/api'

// Where new users drop off: one row per weekly sign-up cohort, one column per
// step. Counts only.
export default function AdminFunnelPage() {
  const query = useQuery({
    queryKey: ['admin-funnel'],
    queryFn: async () =>
      unwrap(await apiService.adminGetFunnel(), 'Failed to load the funnel'),
  })

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <PageHeader
        title="Funnel"
        description="How far each week's new accounts got, from sign-up to first payment."
      />

      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {(query.error as Error).message}
        </p>
      )}
      {query.isLoading && (
        <Card>
          <CardContent className="space-y-3" aria-label="Loading">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </CardContent>
        </Card>
      )}
      {query.isSuccess && (
        <Card>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th scope="col" className="py-2 text-left font-medium">
                      Week of
                    </th>
                    {FUNNEL_STEPS.map((step) => (
                      <th
                        key={step.key}
                        scope="col"
                        className="py-2 pl-4 font-medium whitespace-nowrap"
                      >
                        {step.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {query.data.cohorts.map((cohort) => (
                    <tr
                      key={cohort.weekStart}
                      className="border-b border-border/60"
                    >
                      <th
                        scope="row"
                        className="py-2 text-left font-mono text-xs font-normal whitespace-nowrap"
                      >
                        {cohort.weekStart}
                      </th>
                      {FUNNEL_STEPS.map((step) => {
                        const count = cohort[step.key]
                        const share = shareOfSignUps(count, cohort.signedUp)
                        return (
                          <td
                            key={step.key}
                            className="py-2 pl-4 tabular-nums whitespace-nowrap"
                          >
                            {count ?? '—'}
                            {share && (
                              <>
                                {' '}
                                <span className="text-xs text-muted-foreground">
                                  {share}
                                </span>
                              </>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {query.isSuccess && (
        <div className="space-y-2 text-sm text-muted-foreground">
          <dl className="space-y-1">
            {FUNNEL_STEPS.map((step) => (
              <div key={step.key}>
                <dt className="inline font-medium text-foreground">
                  {step.label}
                </dt>
                <dd className="inline">: {step.definition}</dd>
              </div>
            ))}
          </dl>
          <p>Admin accounts and deleted accounts are not counted.</p>
        </div>
      )}
    </div>
  )
}
