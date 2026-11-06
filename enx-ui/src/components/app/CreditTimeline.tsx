'use client'

import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import CreditBalance from '@/components/admin/CreditBalance'
import {
  aiFeatureLabel,
  balanceText,
  groupTimeline,
  localDate,
  localTime,
  signedCredits,
  supportNote,
  transactionLabel,
} from '@/lib/creditHistory'
import { cn } from '@/lib/utils'
import type {
  AdminLedgerEntry,
  CreditDirection,
  CreditTransaction,
} from '@/types'

type Entry = CreditTransaction | AdminLedgerEntry

const FILTERS: { direction: CreditDirection; label: string; empty: string }[] =
  [
    { direction: '', label: 'All', empty: 'No credit transactions yet.' },
    { direction: 'in', label: 'Added', empty: 'No credits added yet.' },
    { direction: 'out', label: 'Used', empty: 'No credits used yet.' },
  ]

// The credit history timeline (ADR-063), shared by the user's
// /billing/history and the admin's /admin/users/[id]: the same rows, filter,
// labels and same-day grouping. Admin mode adds the raw codes, source, note
// and per-pool balance under each row.
export default function CreditTimeline({
  queryKey,
  load,
  admin = false,
}: {
  queryKey: readonly unknown[]
  load: (
    before: string,
    direction: CreditDirection
  ) => Promise<{ transactions: Entry[]; next: string }>
  admin?: boolean
}) {
  const [direction, setDirection] = useState<CreditDirection>('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const query = useInfiniteQuery({
    queryKey: [...queryKey, direction],
    initialPageParam: '',
    queryFn: ({ pageParam }) => load(pageParam, direction),
    getNextPageParam: (last) => last.next || undefined,
  })
  const entries = query.data?.pages.flatMap((p) => p.transactions) ?? []
  const items = groupTimeline(entries)
  const filter = FILTERS.find((f) => f.direction === direction)!

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="space-y-4">
      <div
        role="group"
        aria-label="Filter"
        className="inline-flex rounded-lg bg-muted p-1"
      >
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={direction === f.direction}
            onClick={() => setDirection(f.direction)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.97] motion-reduce:active:scale-100',
              direction === f.direction
                ? 'bg-background text-brand shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {query.isPending && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">{filter.empty}</p>
      )}
      {items.length > 0 && (
        <ol
          aria-label="Credit transactions"
          className="divide-y divide-border/60"
        >
          {items.map((item) => {
            if (item.kind === 'row') {
              const e = item.row
              return (
                <li
                  key={rowKey(e)}
                  className="flex items-start justify-between gap-4 py-3 text-sm"
                >
                  <RowDetails entry={e} admin={admin} />
                  <Amounts
                    amount={e.amount}
                    total={e.totalBalanceAfter}
                    entry={e}
                    admin={admin}
                  />
                </li>
              )
            }
            const [newest] = item.rows
            const key = `group-${rowKey(newest)}`
            const name = `${aiFeatureLabel(item.feature)} ×${item.count}`
            const open = expanded.has(key)
            return (
              <li key={key} className="py-1 text-sm">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={key}
                  onClick={() => toggle(key)}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-start justify-between gap-4 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:bg-muted"
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex items-center gap-1 font-medium">
                      {name}
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                          open && 'rotate-180'
                        )}
                      />
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {localDate(newest.createdAt)}
                    </span>
                  </span>
                  <Amounts
                    amount={item.amount}
                    total={item.totalBalanceAfter}
                  />
                </button>
                {open && (
                  <ol
                    id={key}
                    aria-label={name}
                    className="mb-2 ml-3 divide-y divide-border/40 border-l border-border pl-3"
                  >
                    {item.rows.map((e) => (
                      <li
                        key={rowKey(e)}
                        className="flex items-start justify-between gap-4 py-2"
                      >
                        <RowDetails entry={e} admin={admin} timeOnly />
                        <Amounts
                          amount={e.amount}
                          total={e.totalBalanceAfter}
                          entry={e}
                          admin={admin}
                        />
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="active:scale-[0.97]"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  )
}

// Rows carry no id on the user's side; time, type and feature tell them
// apart well enough for React.
function rowKey(e: Entry): string {
  return 'id' in e ? e.id : `${e.createdAt}-${e.type}-${e.feature}`
}

function isAdminEntry(e: Entry): e is AdminLedgerEntry {
  return 'source' in e
}

function RowDetails({
  entry: e,
  admin,
  timeOnly = false,
}: {
  entry: Entry
  admin: boolean
  timeOnly?: boolean
}) {
  const { label, explanation } = transactionLabel(e)
  const note = supportNote(e)
  return (
    <div className="min-w-0 space-y-0.5">
      {!timeOnly && <p className="font-medium">{label}</p>}
      {explanation && (
        <p className="text-xs text-muted-foreground">{explanation}</p>
      )}
      {note && <p className="break-words text-xs">{note}</p>}
      {admin && isAdminEntry(e) && (
        <>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {e.type}
            {e.feature && ` · ${e.feature}`}
          </p>
          <p className="text-xs text-muted-foreground">source: {e.source}</p>
          {e.note && !note && (
            <p className="break-words text-xs text-muted-foreground">
              note: {e.note}
            </p>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {timeOnly
          ? localTime(e.createdAt)
          : `${localDate(e.createdAt)} · ${localTime(e.createdAt)}`}
      </p>
    </div>
  )
}

function Amounts({
  amount,
  total,
  entry,
  admin = false,
}: {
  amount: number
  total: number | null
  entry?: Entry
  admin?: boolean
}) {
  return (
    <span className="block shrink-0 text-right">
      <span
        className={cn(
          'block font-semibold tabular-nums',
          amount > 0 ? 'text-brand' : 'text-foreground'
        )}
      >
        {signedCredits(amount)}
      </span>
      <span className="block text-xs text-muted-foreground">
        balance <span className="tabular-nums">{balanceText(total)}</span>
      </span>
      {admin && entry && isAdminEntry(entry) && (
        <span
          className="block text-xs text-muted-foreground"
          title="Balance after this entry: the pool it changed, or the total for AI usage"
        >
          pool after: <CreditBalance value={entry.balanceAfter} />
        </span>
      )}
    </span>
  )
}
