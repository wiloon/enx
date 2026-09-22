'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiService } from '@/services/api'
import type { AdminPageReport } from '@/types'

function formatWhen(ms: number): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
  } catch {
    return String(ms)
  }
}

export default function AdminPageReportsPage() {
  const query = useQuery({
    queryKey: ['admin-page-reports'],
    queryFn: async () => {
      const resp = await apiService.adminListPageReports()
      if (resp.success && resp.data?.reports) return resp.data.reports
      throw new Error(resp.error || 'Failed to load page reports')
    },
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Page reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Learning-mode failures users confirmed sending. Sanitized URL only —
          no page content. Newest first.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {query.isLoading
              ? 'Loading…'
              : query.isError
                ? 'Could not load'
                : `${query.data?.length ?? 0} report(s)`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.isError && (
            <p role="alert" className="text-sm text-destructive">
              {(query.error as Error).message}
            </p>
          )}
          {query.isSuccess && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No page reports yet.</p>
          )}
          {query.isSuccess && query.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Host</th>
                    <th className="py-2 pr-3 font-medium">Reason</th>
                    <th className="py-2 pr-3 font-medium">URL</th>
                    <th className="py-2 pr-3 font-medium">Adapter</th>
                    <th className="py-2 font-medium">Ext</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((r: AdminPageReport) => (
                    <tr key={r.id} className="border-b border-border/60 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs">
                        {formatWhen(r.createdAt)}
                      </td>
                      <td className="py-2 pr-3">{r.host}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.reason}</td>
                      <td className="py-2 pr-3 break-all font-mono text-xs">
                        {r.url}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {r.adapter || '—'}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {r.extVersion || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
