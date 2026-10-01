'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import WordEditor from '@/components/admin/WordEditor'
import { apiService } from '@/services/api'
import type { AdminWordRow } from '@/types'

const PAGE_SIZE = 25

// AI-made definitions (ADR-045). Until an admin has edited or approved one it
// is visible only to users who can use AI, so this queue is the backlog of what
// everyone else cannot see yet. The busiest words come first: the ones most
// users have in their vocabulary are the ones most worth checking.
export default function AdminAiWordsPage() {
  const [reviewed, setReviewed] = useState(false)
  const [page, setPage] = useState(0)

  const query = useQuery({
    queryKey: ['admin-ai-words', reviewed, page],
    queryFn: async () => {
      const resp = await apiService.adminListAiWords(
        reviewed,
        PAGE_SIZE,
        page * PAGE_SIZE
      )
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load AI definitions')
    },
  })

  // Reviewing the last row of a later page leaves it empty: step back. Done
  // while rendering, not in an effect, so the empty page is never painted.
  const rowCount = query.data?.words.length
  if (rowCount === 0 && page > 0) {
    setPage(page - 1)
  }

  const total = query.data?.total ?? 0
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = page * PAGE_SIZE + (rowCount ?? 0)

  const switchTab = (next: boolean) => {
    setReviewed(next)
    setPage(0)
  }

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">AI Definitions</h2>
        <p className="text-muted-foreground">
          Definitions the AI wrote for words neither the <code>words</code>{' '}
          table nor ECDICT had. Until you edit or approve one, only users who
          can use AI can see it. Busiest first.
        </p>
      </div>

      <div role="tablist" className="mb-4 flex gap-2">
        {[
          { label: 'Unreviewed', value: false },
          { label: 'Reviewed', value: true },
        ].map((tab) => (
          <Button
            key={tab.label}
            role="tab"
            aria-selected={reviewed === tab.value}
            variant={reviewed === tab.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => switchTab(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {query.isLoading && <p className="text-muted-foreground">Loading…</p>}
      {query.error && (
        <div className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">
          {(query.error as Error).message}
        </div>
      )}
      {query.data && query.data.words.length === 0 && (
        <p className="text-muted-foreground">
          {reviewed ? 'Nothing has been reviewed yet.' : 'Nothing to review.'}
        </p>
      )}

      <div className="space-y-4">
        {query.data?.words.map((row) => (
          <AiWordCard key={row.id} row={row} />
        ))}
      </div>

      {query.data && total > 0 && (
        <div className="mt-6 flex items-center justify-between text-sm">
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
    </div>
  )
}

function AiWordCard({ row }: { row: AdminWordRow }) {
  const queryClient = useQueryClient()
  const english = row.english ?? ''
  const [editing, setEditing] = useState(false)
  const [confirmingReject, setConfirmingReject] = useState(false)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-ai-words'] })
    queryClient.invalidateQueries({ queryKey: ['admin-word', english] })
  }

  // An edit, with the text unchanged, is an approval (ADR-045).
  const save = useMutation({
    mutationFn: async (edit: { chinese: string; pronunciation: string }) => {
      const resp = await apiService.adminEditWord(
        english,
        edit.chinese,
        edit.pronunciation
      )
      if (resp.success && resp.data?.success) return resp.data
      throw new Error(resp.error || 'Save failed')
    },
    onSuccess: () => {
      setEditing(false)
      refresh()
    },
  })

  // Removes the definition and every user's vocabulary entry for it.
  const reject = useMutation({
    mutationFn: async () => {
      const resp = await apiService.deleteWord(english)
      if (resp.success && resp.data?.success) return resp.data
      throw new Error(resp.error || 'Delete failed')
    },
    onSuccess: refresh,
  })

  const reviewed = !!row.adminEditedAt
  const busy = save.isPending || reject.isPending
  const error = save.error ?? reject.error

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">{english}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {row.users ?? 0} {row.users === 1 ? 'user' : 'users'} ·{' '}
            {row.lookups ?? 0} {row.lookups === 1 ? 'lookup' : 'lookups'}
            {row.aiQuality != null && <> · AI confidence {row.aiQuality}/10</>}
            {reviewed && row.adminEditedAt && (
              <>
                {' '}
                · reviewed {new Date(row.adminEditedAt).toLocaleDateString()}
              </>
            )}
          </p>
        </div>
        {!editing && !confirmingReject && (
          <div className="flex shrink-0 gap-2">
            {!reviewed && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  save.mutate({
                    chinese: row.chinese ?? '',
                    pronunciation: row.pronunciation ?? '',
                  })
                }
                title="Keep the definition as it is and release it to every user"
              >
                {save.isPending ? 'Approving…' : 'Approve'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmingReject(true)}
            >
              Reject
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <WordEditor
            idPrefix={`edit-${row.id}`}
            initialChinese={row.chinese ?? ''}
            initialPronunciation={row.pronunciation ?? ''}
            saving={save.isPending}
            error={save.error ? (save.error as Error).message : null}
            onSave={(chinese, pronunciation) =>
              save.mutate({ chinese, pronunciation })
            }
            onCancel={() => {
              setEditing(false)
              save.reset()
            }}
          />
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm">{row.chinese}</p>
            {row.pronunciation && (
              <p className="font-mono text-sm text-muted-foreground">
                {row.pronunciation}
              </p>
            )}
          </>
        )}

        {confirmingReject && (
          <div
            role="alertdialog"
            aria-label={`Reject ${english}`}
            className="space-y-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900"
          >
            <p>
              Delete this definition for everyone? It also removes the word from
              every user&apos;s vocabulary. The next AI lookup may write it
              again.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={reject.isPending}
                onClick={() => reject.mutate()}
              >
                {reject.isPending ? 'Deleting…' : 'Confirm reject'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setConfirmingReject(false)
                  reject.reset()
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {error && !editing && (
          <p role="alert" className="text-sm text-red-700">
            {(error as Error).message}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
