'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { apiService } from '@/services/api'
import { approximateWords } from '@/lib/statsWindow'

// Home's status strip (ADR-027 Decision 1, contract from ADR-028 Decision 6).
// What replaced "Continue reading": the question Home should answer on open
// is "where am I", not "which document would you like to reopen" -- that one
// has a page of its own.
//
// Everything here is one GET: today, this week, the last seven days, and the
// size of the word list.

/** Days in the sparkline; the server sends exactly this many, zero-filled. */
const SPARKLINE_DAYS = 7

export default function StatStrip() {
  // Same query key as the page's own overview call, so the two share one
  // request rather than racing: Home needs `vocab.total` to choose between
  // onboarding and this strip, and this strip needs the rest of the payload.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stats-overview'],
    queryFn: async () => {
      const resp = await apiService.getStatsOverview()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load statistics')
    },
  })

  if (isLoading) {
    return (
      <div className="h-32 animate-pulse rounded-lg border bg-muted" aria-hidden />
    )
  }

  // Home's first screen degrades block by block rather than failing whole
  // (ADR-027 Mitigation).
  if (isError || !data) return null

  return (
    <Link
      href="/stats"
      className="group block rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:border-brand/40 hover:shadow-sm"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Today</h3>
        <ChevronRight
          aria-hidden
          className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Words read" value={approximateWords(data.today.wordsRead)} />
        <Figure label="Looked up" value={data.today.wordLookups.toLocaleString()} />
        <Figure label="This week" value={approximateWords(data.week.wordsRead)} />
        <Figure label="Word list" value={data.vocab.total.toLocaleString()} />
      </div>

      <Sparkline values={data.sparkline} />
    </Link>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
    </div>
  )
}

/**
 * The last seven days of words read. No axis and no numbers: it is here to
 * show a shape -- whether the week has been steady or a single burst -- and
 * the page it links to carries the readable version.
 */
function Sparkline({ values }: { values: number[] }) {
  const days = values.slice(-SPARKLINE_DAYS)
  const max = Math.max(...days, 1)
  if (days.every((v) => v === 0)) return null

  return (
    <div
      className="mt-4 flex h-10 items-end gap-1"
      role="img"
      aria-label={`Words read over the last ${days.length} days`}
    >
      {days.map((value, i) => (
        <div
          key={i}
          // A day with nothing read still gets a visible sliver, so the
          // strip reads as seven days rather than as however many were
          // non-zero.
          className="flex-1 rounded-t bg-brand"
          style={{
            height: `${Math.max(4, (value / max) * 100)}%`,
            // Fades the sliver that stands in for an empty day, so "read
            // nothing" and "read a little" don't look the same.
            opacity: value === 0 ? 0.25 : 1,
          }}
        />
      ))}
    </div>
  )
}

