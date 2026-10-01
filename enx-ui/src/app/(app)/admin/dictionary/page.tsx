'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiService } from '@/services/api'
import WordEditor from '@/components/admin/WordEditor'
import type { AdminEcdictRow, AdminWordRow } from '@/types'

type Consistency =
  | { kind: 'loading' }
  | { kind: 'neither' }
  | { kind: 'missing-word' }
  | { kind: 'no-ecdict' }
  | { kind: 'in-sync' }
  | { kind: 'out-of-sync'; chinese: boolean; pronunciation: boolean }

function assess(
  word: AdminWordRow | undefined,
  ecdict: AdminEcdictRow | undefined
): Consistency {
  if (!word || !ecdict) return { kind: 'loading' }
  if (!word.found && !ecdict.found) return { kind: 'neither' }
  if (!word.found && ecdict.found) return { kind: 'missing-word' }
  if (word.found && !ecdict.found) return { kind: 'no-ecdict' }
  const chinese = (word.chinese ?? '') === (ecdict.translation ?? '')
  const pronunciation = (word.pronunciation ?? '') === (ecdict.phonetic ?? '')
  if (chinese && pronunciation) return { kind: 'in-sync' }
  return { kind: 'out-of-sync', chinese, pronunciation }
}

function Field({
  label,
  value,
  mono,
}: {
  label: string
  value?: string | number | null
  mono?: boolean
}) {
  const empty = value === undefined || value === null || value === ''
  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <div
        className={
          mono ? 'font-mono text-sm break-all' : 'text-sm whitespace-pre-wrap'
        }
      >
        {empty ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          String(value)
        )}
      </div>
    </div>
  )
}

function ConsistencyBanner({ c }: { c: Consistency }) {
  const style: Record<Consistency['kind'], string> = {
    loading: 'bg-muted text-muted-foreground',
    neither: 'bg-muted text-muted-foreground',
    'missing-word': 'bg-amber-100 text-amber-900',
    'no-ecdict': 'bg-muted text-muted-foreground',
    'in-sync': 'bg-green-100 text-green-900',
    'out-of-sync': 'bg-amber-100 text-amber-900',
  }
  let text: string
  switch (c.kind) {
    case 'loading':
      text = 'Checking…'
      break
    case 'neither':
      text = 'Not found in the words table or in ECDICT.'
      break
    case 'missing-word':
      text = 'Missing from the words table — Sync from ECDICT to add it.'
      break
    case 'no-ecdict':
      text = 'No ECDICT entry — nothing to sync from.'
      break
    case 'in-sync':
      text = 'In sync — the words table matches ECDICT.'
      break
    case 'out-of-sync': {
      const fields = [
        c.chinese ? null : 'translation',
        c.pronunciation ? null : 'pronunciation',
      ].filter(Boolean)
      text = `Out of sync — ${fields.join(' and ')} differ${
        fields.length > 1 ? '' : 's'
      } from ECDICT.`
      break
    }
  }
  return (
    <div
      className={`rounded-md px-3 py-2 text-sm ${style[c.kind]}`}
      role="status"
    >
      {text}
    </div>
  )
}

// When an admin last edited or approved a row, or "Never".
function editedLabel(ms?: number | null): string {
  return ms ? new Date(ms).toLocaleString() : 'Never'
}

export default function AdminDictionaryPage() {
  const [input, setInput] = useState('')
  const [word, setWord] = useState('')
  const [editing, setEditing] = useState(false)
  const queryClient = useQueryClient()

  const wordQuery = useQuery({
    queryKey: ['admin-word', word],
    queryFn: async () => {
      const resp = await apiService.adminGetWord(word)
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load words-table row')
    },
    enabled: !!word,
  })

  const ecdictQuery = useQuery({
    queryKey: ['admin-ecdict', word],
    queryFn: async () => {
      const resp = await apiService.adminGetEcdict(word)
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load ECDICT row')
    },
    enabled: !!word,
  })

  const sync = useMutation({
    mutationFn: async () => {
      const resp = await apiService.adminSyncWordFromEcdict(word)
      if (resp.success && resp.data?.success) return resp.data
      throw new Error(resp.error || 'Sync failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-word', word] })
      queryClient.invalidateQueries({ queryKey: ['admin-ecdict', word] })
    },
  })

  // Saving an edit also approves an AI-made row: an edited row is no longer
  // hidden from users who can't use AI (ADR-045).
  const save = useMutation({
    mutationFn: async (edit: { chinese: string; pronunciation: string }) => {
      const resp = await apiService.adminEditWord(
        word,
        edit.chinese,
        edit.pronunciation
      )
      if (resp.success && resp.data?.success) return resp.data
      throw new Error(resp.error || 'Save failed')
    },
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['admin-word', word] })
      queryClient.invalidateQueries({ queryKey: ['admin-ai-words'] })
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = input.trim().toLowerCase()
    if (next) {
      setWord(next)
      setEditing(false)
      sync.reset()
      save.reset()
    }
  }

  const consistency = assess(wordQuery.data, ecdictQuery.data)
  const canSync = ecdictQuery.data?.found === true && !sync.isPending
  const row = wordQuery.data
  const canEdit = row?.found === true && row.deletedAt == null
  const awaitingReview = canEdit && row?.source === 'ai' && !row?.adminEditedAt

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Dictionary Maintenance</h2>
        <p className="text-muted-foreground">
          Compare a word&apos;s <code>words</code>-table entry against ECDICT
          and, if they diverge, copy ECDICT&apos;s data onto the{' '}
          <code>words</code> row. The <code>words</code> table is a shared cache
          — a sync affects every user&apos;s next lookup.
        </p>
      </div>

      <form onSubmit={submit} className="mb-6 flex items-end gap-3">
        <div className="flex-1 space-y-2">
          <Label htmlFor="admin-word-input">English word</Label>
          <Input
            id="admin-word-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a word to inspect…"
          />
        </div>
        <Button type="submit">Look Up</Button>
      </form>

      {word && (
        <div className="space-y-4">
          {(wordQuery.error || ecdictQuery.error) && (
            <div className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">
              {(wordQuery.error as Error)?.message ||
                (ecdictQuery.error as Error)?.message}
            </div>
          )}

          <ConsistencyBanner c={consistency} />

          {sync.error && (
            <div className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">
              {(sync.error as Error).message}
            </div>
          )}
          {sync.isSuccess && (
            <div className="rounded-md bg-green-100 px-3 py-2 text-sm text-green-900">
              Synced from ECDICT.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  words table
                  {wordQuery.data?.found === false && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (no row)
                    </span>
                  )}
                  {wordQuery.data?.deletedAt != null && (
                    <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-800">
                      soft-deleted
                    </span>
                  )}
                </CardTitle>
                <div className="flex gap-2">
                  {canEdit && !editing && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </Button>
                  )}
                  {awaitingReview && !editing && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={save.isPending}
                      onClick={() =>
                        save.mutate({
                          chinese: row?.chinese ?? '',
                          pronunciation: row?.pronunciation ?? '',
                        })
                      }
                      title="Keep the definition as it is and release it to every user"
                    >
                      {save.isPending ? 'Approving…' : 'Approve'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => sync.mutate()}
                    disabled={!canSync}
                    title={
                      ecdictQuery.data?.found
                        ? 'Overwrite chinese / pronunciation from ECDICT'
                        : 'No ECDICT entry to sync from'
                    }
                  >
                    {sync.isPending ? 'Syncing…' : 'Sync from ECDICT'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {wordQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : wordQuery.data?.found ? (
                  <>
                    {wordQuery.data.source === 'ai' && (
                      <div
                        role="status"
                        className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900"
                      >
                        {wordQuery.data.adminEditedAt
                          ? 'AI-made definition, reviewed by an admin — visible to every user.'
                          : 'AI-made definition, not yet reviewed — only users who can use AI see it until you approve or edit it.'}
                      </div>
                    )}
                    <Field label="English" value={wordQuery.data.english} />
                    {editing ? (
                      <WordEditor
                        idPrefix="admin-word"
                        initialChinese={wordQuery.data.chinese ?? ''}
                        initialPronunciation={
                          wordQuery.data.pronunciation ?? ''
                        }
                        saving={save.isPending}
                        error={
                          save.error ? (save.error as Error).message : null
                        }
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
                        <Field label="Chinese" value={wordQuery.data.chinese} />
                        <Field
                          label="Pronunciation"
                          value={wordQuery.data.pronunciation}
                          mono
                        />
                      </>
                    )}
                    {save.error && !editing && (
                      <p role="alert" className="text-sm text-red-700">
                        {(save.error as Error).message}
                      </p>
                    )}
                    <Field
                      label="Source"
                      value={
                        wordQuery.data.source === 'ai'
                          ? 'AI (model-written)'
                          : 'ECDICT'
                      }
                    />
                    <Field
                      label="Edited by an admin"
                      value={editedLabel(wordQuery.data.adminEditedAt)}
                    />
                    {wordQuery.data.source === 'ai' && (
                      <>
                        <Field
                          label="AI confidence"
                          value={
                            wordQuery.data.aiQuality != null
                              ? `${wordQuery.data.aiQuality} / 10`
                              : undefined
                          }
                        />
                        <Field
                          label="Prompt version"
                          value={wordQuery.data.aiPromptVersion}
                          mono
                        />
                      </>
                    )}
                    <Field
                      label="Users with this word"
                      value={wordQuery.data.users ?? 0}
                    />
                    <Field
                      label="Total lookups"
                      value={wordQuery.data.lookups ?? 0}
                    />
                    <Field label="Row id" value={wordQuery.data.id} mono />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This word is not in the words table.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  ECDICT
                  {ecdictQuery.data?.matchedBy && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (matched by {ecdictQuery.data.matchedBy})
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {ecdictQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : ecdictQuery.data?.found ? (
                  <>
                    <Field label="Word" value={ecdictQuery.data.word} />
                    <Field
                      label="Translation"
                      value={ecdictQuery.data.translation}
                    />
                    <Field
                      label="Phonetic"
                      value={ecdictQuery.data.phonetic}
                      mono
                    />
                    <Field
                      label="Strip-word (sw)"
                      value={ecdictQuery.data.sw}
                      mono
                    />
                    <Field
                      label="Exchange"
                      value={ecdictQuery.data.exchange}
                      mono
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This word is not in ECDICT.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
