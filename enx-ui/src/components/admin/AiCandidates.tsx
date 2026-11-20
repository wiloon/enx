'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiService } from '@/services/api'
import { unwrap } from '@/lib/apiResult'
import type { AdminAiCandidate } from '@/types'

const PAGE_SIZE = 25

type Status = 'pending' | 'rejected'

// AI candidate definitions (ADR-091): AI answers that were not written to
// `words` (low confidence, or the user hit the daily cache limit). Every AI
// user already gets them; approving one releases it to every user, rejecting
// one makes later lookups answer "no definition". Busiest first.
export default function AiCandidates() {
  const [status, setStatus] = useState<Status>('pending')
  const [page, setPage] = useState(0)

  const query = useQuery({
    queryKey: ['admin-ai-candidates', status, page],
    // A later page emptied by a review may have been filled again.
    staleTime: 0,
    queryFn: async () => {
      const resp = await apiService.adminListAiCandidates(
        status,
        PAGE_SIZE,
        page * PAGE_SIZE
      )
      return unwrap(resp, 'Failed to load AI candidate definitions')
    },
  })

  // Step back only when the current visit confirms the page is empty.
  const rowCount = query.data?.candidates.length
  if (
    page > 0 &&
    rowCount === 0 &&
    query.isSuccess &&
    query.isFetchedAfterMount &&
    !query.isFetching
  ) {
    setPage(page - 1)
  }

  const total = query.data?.total ?? 0
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = page * PAGE_SIZE + (rowCount ?? 0)

  const switchTab = (next: Status) => {
    setStatus(next)
    setPage(0)
  }

  return (
    <section aria-label="AI candidate definitions" className="mt-10">
      <h2 className="text-lg font-semibold">AI candidate definitions</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        AI answers kept out of the <code>words</code> table. Approve to release
        one to every user; reject to make later lookups answer &quot;no
        definition&quot;. Busiest first.
      </p>

      <div role="tablist" className="mb-4 flex gap-2">
        {(
          [
            { label: 'Pending', value: 'pending' },
            { label: 'Rejected', value: 'rejected' },
          ] as const
        ).map((tab) => (
          <Button
            key={tab.value}
            role="tab"
            aria-selected={status === tab.value}
            variant="outline"
            className="aria-selected:border-brand aria-selected:bg-brand/10 aria-selected:text-brand"
            size="sm"
            onClick={() => switchTab(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {(query.isLoading ||
        (page > 0 && rowCount === 0 && query.isFetching)) && (
        <p className="text-muted-foreground">Loading…</p>
      )}
      {query.error && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {(query.error as Error).message}
        </div>
      )}
      {page === 0 && rowCount === 0 && (
        <p className="text-muted-foreground">
          {status === 'pending'
            ? 'No pending candidates.'
            : 'No rejected candidates.'}
        </p>
      )}

      <div className="space-y-4">
        {query.data?.candidates.map((row) => (
          <CandidateCard key={row.english} row={row} />
        ))}
      </div>

      {rowCount != null && rowCount > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Showing {from}–{to} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={to >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function CandidateCard({ row }: { row: AdminAiCandidate }) {
  const queryClient = useQueryClient()

  const act = useMutation({
    mutationFn: async (action: 'approve' | 'reject' | 'unreject') => {
      const resp = await apiService.adminReviewAiCandidate(row.english, action)
      if (resp.success && resp.data?.ok) return resp.data
      throw new Error(resp.error || 'Update failed')
    },
    onSuccess: (_result, action) => {
      queryClient.invalidateQueries({ queryKey: ['admin-ai-candidates'] })
      if (action === 'approve') {
        queryClient.invalidateQueries({ queryKey: ['admin-word'] })
        queryClient.invalidateQueries({ queryKey: ['admin-ai-words'] })
      }
    },
  })

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-lg wrap-anywhere">{row.english}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            quality {row.quality}/10 · {row.hitCount}{' '}
            {row.hitCount === 1 ? 'hit' : 'hits'} · first{' '}
            {new Date(row.firstHitAt).toLocaleString()} · last{' '}
            {new Date(row.lastHitAt).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {row.status === 'pending' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={act.isPending}
                onClick={() => act.mutate('approve')}
                title="Add the definition to the words table for every user"
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={act.isPending}
                onClick={() => act.mutate('reject')}
              >
                Reject
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => act.mutate('unreject')}
            >
              Un-reject
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="whitespace-pre-wrap text-sm">{row.chinese}</p>
        {act.error && (
          <p role="alert" className="text-sm text-destructive">
            {(act.error as Error).message}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
