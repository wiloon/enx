'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { apiService } from '@/services/api'
import SegmentedControl from '@/components/app/stats/SegmentedControl'
import TrendChart, { type TrendDatum } from '@/components/app/stats/TrendChart'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  approximateWords,
  bucketLabels,
  lookupDensity,
  seriesWindow,
} from '@/lib/statsWindow'
import type { StatsPeriod, StatsPoint } from '@/types'

// Reading Stats (ADR-028 Decision 6/7). One chart, two switches above it:
// the bucket size (day / week / month / year) and the measure. It used to be
// three static cards, one per period, which forced the reader to compare
// numbers across blocks instead of reading a shape.
//
// The measure switch is what keeps this to one chart honestly: words read and
// lookups live on scales two orders of magnitude apart, and putting both on
// one plot would need a second y-axis -- an axis pair you can always choose
// to make any two lines agree.

type MetricId = 'wordsRead' | 'articlesRead' | 'density'

const METRICS: {
  id: MetricId
  label: string
  title: string
  subtitle: string
  kind: 'bar' | 'line'
  valueLabel: string
}[] = [
  {
    id: 'wordsRead',
    label: 'Words read',
    title: 'Words read',
    subtitle:
      'Estimated from where you looked words up and how far you scrolled.',
    kind: 'bar',
    valueLabel: 'words',
  },
  {
    id: 'articlesRead',
    label: 'Articles',
    title: 'Articles read',
    subtitle: 'Counted once you get past the first fifth of a piece.',
    kind: 'bar',
    valueLabel: 'articles',
  },
  {
    id: 'density',
    label: 'New-word density',
    // ADR-028 Decision 7: on this one, down is progress. Say so on the chart
    // -- a reader who assumes higher is better reads their own progress as
    // decline.
    title: 'Lookups per 1,000 words — lower is better',
    subtitle:
      'How often you needed a definition. It falls as more of what you read is already yours.',
    kind: 'line',
    valueLabel: 'lookups / 1,000 words',
  },
]

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
]

function metricValue(
  point: StatsPoint,
  metric: MetricId,
  period: StatsPeriod
): number | null {
  switch (metric) {
    case 'wordsRead':
      return point.totals.wordsRead
    case 'articlesRead':
      return point.totals.articlesRead
    case 'density':
      return lookupDensity(point, period)
  }
}

export default function ReadingStatsPage() {
  const [period, setPeriod] = useState<StatsPeriod>('day')
  const [metric, setMetric] = useState<MetricId>('wordsRead')

  const { from, to } = useMemo(() => seriesWindow(period), [period])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['stats-series', period, from, to],
    queryFn: async () => {
      const resp = await apiService.getStatsSeries(period, from, to)
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load statistics')
    },
  })

  const active = METRICS.find((m) => m.id === metric)!

  const chartData: TrendDatum[] = useMemo(
    () =>
      (data?.points ?? []).map((point) => ({
        ...bucketLabels(period, point.date),
        value: metricValue(point, metric, period),
      })),
    [data, metric, period]
  )

  const total = (data?.points ?? []).reduce(
    (sum, p) => sum + p.totals.wordsRead,
    0
  )
  const lookups = (data?.points ?? []).reduce(
    (sum, p) => sum + p.totals.wordLookups,
    0
  )
  const articles = (data?.points ?? []).reduce(
    (sum, p) => sum + p.totals.articlesRead,
    0
  )

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Reading Stats</h2>
          <p className="text-sm text-muted-foreground">
            The same measures at four zoom levels — switch the bucket rather
            than the page.
          </p>
        </div>
        <SegmentedControl
          name="stats-period"
          label="Bucket size"
          value={period}
          options={PERIODS}
          onChange={setPeriod}
        />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <SegmentedControl
            name="stats-metric"
            label="Measure"
            value={metric}
            options={METRICS.map((m) => ({ value: m.id, label: m.label }))}
            onChange={setMetric}
          />
          <div>
            <h3 className="font-semibold">{active.title}</h3>
            <p className="text-sm text-muted-foreground">{active.subtitle}</p>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div
              className="h-[240px] animate-pulse rounded bg-muted"
              aria-hidden
            />
          )}
          {isError && (
            <p className="py-20 text-center text-sm text-muted-foreground">
              Couldn&apos;t load your statistics.
            </p>
          )}
          {!isLoading && !isError && (
            <TrendChart
              data={chartData}
              kind={active.kind}
              valueLabel={active.valueLabel}
              // Words read is inferred, so it is rounded everywhere it
              // appears -- axis, tooltip and table alike (ADR-028 Decision
              // 8). A table that prints "1,237" under a tile that says
              // "1,200" makes the tile look like the lie.
              formatValue={(v) =>
                metric === 'wordsRead'
                  ? approximateWords(v)
                  : metric === 'density'
                    ? String(Math.round(v * 10) / 10)
                    : v.toLocaleString()
              }
              gapNote={
                metric === 'density'
                  ? 'Blank where you read too little that period for the ratio to mean anything.'
                  : undefined
              }
            />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile label="Words read" value={approximateWords(total)} />
        <SummaryTile label="Articles read" value={articles.toLocaleString()} />
        <SummaryTile label="Words looked up" value={lookups.toLocaleString()} />
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Words read is an estimate, from where you looked words up and how far
          you scrolled — the real number is usually higher. Catglish stores only
          daily totals: never a URL, a page title, or what you were reading.
        </span>
      </p>
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}
