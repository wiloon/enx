'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiService } from '@/services/api'
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
        {empty ? <span className="text-muted-foreground">—</span> : String(value)}
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
    <div className={`rounded-md px-3 py-2 text-sm ${style[c.kind]}`} role="status">
      {text}
    </div>
  )
}

export default function AdminDictionaryPage() {
  const [input, setInput] = useState('')
  const [word, setWord] = useState('')
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = input.trim().toLowerCase()
    if (next) {
      setWord(next)
      sync.reset()
    }
  }

  const consistency = assess(wordQuery.data, ecdictQuery.data)
  const canSync = ecdictQuery.data?.found === true && !sync.isPending

  return (
    <div className="mx-auto max-w-4xl p-6 md:p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Dictionary Maintenance</h2>
        <p className="text-muted-foreground">
          Compare a word&apos;s <code>words</code>-table entry against ECDICT and,
          if they diverge, copy ECDICT&apos;s data onto the <code>words</code>{' '}
          row. The <code>words</code> table is a shared cache — a sync affects
          every user&apos;s next lookup.
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
              </CardHeader>
              <CardContent className="space-y-3">
                {wordQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : wordQuery.data?.found ? (
                  <>
                    <Field label="English" value={wordQuery.data.english} />
                    <Field label="Chinese" value={wordQuery.data.chinese} />
                    <Field
                      label="Pronunciation"
                      value={wordQuery.data.pronunciation}
                      mono
                    />
                    <Field
                      label="Lookup count"
                      value={wordQuery.data.loadCount ?? 0}
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
