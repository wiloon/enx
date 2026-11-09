'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import PageHeader from '@/components/app/PageHeader'
import { apiService } from '@/services/api'
import type { AdminFeedback, FeedbackKind, FeedbackStatus } from '@/types'

const PAGE_SIZE = 100

const KINDS: { value: FeedbackKind | ''; label: string }[] = [
  { value: '', label: 'All kinds' },
  { value: 'page_report', label: 'Page report' },
  { value: 'text', label: 'Text' },
  { value: 'article_choice', label: 'Article choice' },
  { value: 'definition', label: 'Definition' },
]

const STATUSES: { value: FeedbackStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'resolved', label: 'Resolved' },
]

function kindLabel(kind: FeedbackKind): string {
  return KINDS.find((k) => k.value === kind)?.label ?? kind
}

function formatWhen(ms: number): string {
  if (!ms) return '—'
  return new Date(ms)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC')
}

// "key: value · key: value" for a JSON object of scalar fields.
function fields(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ')
}

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground cursor-pointer transition-colors hover:border-foreground/40 active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

// The feedback queue (ADR-076 Decision 7-8): everything users sent, newest
// first, filtered on the server. Resolving keeps the record.
export default function AdminFeedbackPage() {
  const [kind, setKind] = useState<FeedbackKind | ''>('')
  const [status, setStatus] = useState<FeedbackStatus | ''>('')
  // Offsets of the pages before this one, so Previous can step back.
  const [offsets, setOffsets] = useState<number[]>([0])
  const offset = offsets[offsets.length - 1]

  const query = useQuery({
    queryKey: ['admin-feedback', kind, status, offset],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const resp = await apiService.adminListFeedback({
        kind,
        status,
        limit: PAGE_SIZE,
        offset,
      })
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load feedback')
    },
  })

  const nextOffset = query.data?.nextOffset ?? null
  const rows = query.data?.feedback ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <PageHeader
        title="Feedback"
        description="What users sent: page reports and more. Cleaned URL only — no page content. Newest first."
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Kind
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as FeedbackKind | '')
              setOffsets([0])
            }}
            className={selectClass}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as FeedbackStatus | '')
              setOffsets([0])
            }}
            className={selectClass}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {query.isLoading
              ? 'Loading…'
              : query.isError
                ? 'Could not load'
                : `Records ${rows.length === 0 ? 0 : offset + 1}–${offset + rows.length}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isError && (
            <p role="alert" className="text-sm text-destructive">
              {(query.error as Error).message}
            </p>
          )}
          {query.isSuccess && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No feedback matches.
            </p>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Kind</th>
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Page</th>
                    <th className="py-2 pr-3 font-medium">Details</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <FeedbackRow key={f.id} record={f} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {query.isSuccess && (offset > 0 || nextOffset !== null) && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offsets.length === 1}
                onClick={() => setOffsets(offsets.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={nextOffset === null}
                onClick={() =>
                  nextOffset !== null && setOffsets([...offsets, nextOffset])
                }
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function FeedbackRow({ record: f }: { record: AdminFeedback }) {
  const queryClient = useQueryClient()
  const resolve = useMutation({
    mutationFn: async () => {
      const resp = await apiService.adminResolveFeedback(f.id)
      if (resp.success && resp.data?.success) return resp.data
      throw new Error(resp.error || 'Could not resolve')
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['admin-feedback'] }),
  })
  const details = fields(f.details)
  const context = fields(f.context)

  return (
    <tr className="border-b border-border/60 align-top">
      <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs">
        {formatWhen(f.createdAt)}
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">{kindLabel(f.kind)}</td>
      <td className="py-2 pr-3 max-w-32 break-all font-mono text-xs">
        <Link href={`/admin/users/${f.userId}`} className="hover:underline active:opacity-70 focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
          {f.userId}
        </Link>
      </td>
      <td className="py-2 pr-3 min-w-48 break-all font-mono text-xs">
        {f.url || '—'}
      </td>
      <td className="py-2 pr-3 min-w-40 space-y-1 text-xs">
        {f.text && <p className="whitespace-pre-wrap">{f.text}</p>}
        {details && <p className="font-mono">{details}</p>}
        {context && (
          <p className="font-mono text-muted-foreground">{context}</p>
        )}
      </td>
      <td className="py-2 whitespace-nowrap">
        {f.status === 'resolved' ? (
          <Badge variant="outline">Resolved</Badge>
        ) : (
          <div className="space-y-1">
            <Button
              variant="outline"
              size="sm"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate()}
            >
              {resolve.isPending ? 'Resolving…' : 'Resolve'}
            </Button>
            {resolve.isError && (
              <p role="alert" className="text-xs text-destructive">
                {(resolve.error as Error).message}
              </p>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}
