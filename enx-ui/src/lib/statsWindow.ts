import type { StatsPeriod, StatsPoint } from '@/types'

// The arithmetic behind the period switch on /stats: given a bucket size,
// how far back to ask for, and how to label what comes back.
//
// Kept out of the page component because it is the part that is easy to get
// subtly wrong (a window one bucket short, a label showing the UTC day) and
// the only part worth testing.

/**
 * How many buckets each period shows.
 *
 * Chosen so every view is about one screen of marks: enough history to see a
 * trend, few enough that the bars stay readable without scrolling.
 */
export const BUCKETS: Record<StatsPeriod, number> = {
  day: 30,
  week: 12,
  month: 12,
  year: 5,
}

/**
 * Minimum words read in a bucket before lookups-per-1,000-words is plotted.
 *
 * Below it the ratio is noise: three lookups in a 40-word skim is 75 per
 * thousand, and drawing that spike would tell the user their vocabulary
 * collapsed on a day they barely read (ADR-028 Decision 7).
 */
export const DENSITY_MIN_WORDS: Record<StatsPeriod, number> = {
  day: 200,
  week: 500,
  month: 500,
  year: 500,
}

/** Local YYYY-MM-DD. Never toISOString(), which would give the UTC day. */
export function toLocalISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parses YYYY-MM-DD as a LOCAL date (new Date('2026-01-01') is UTC). */
export function fromLocalISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/**
 * The [from, to] window to request for `period`, inclusive.
 *
 * `from` is snapped back to the start of its bucket so the oldest column is
 * a whole week/month/year rather than a partial one -- an 11-day "month"
 * plotted next to full ones reads as a collapse in reading.
 */
export function seriesWindow(
  period: StatsPeriod,
  today: Date = new Date()
): { from: string; to: string } {
  const to = toLocalISODate(today)
  const count = BUCKETS[period] - 1
  const start = new Date(today)

  switch (period) {
    case 'day':
      start.setDate(start.getDate() - count)
      break
    case 'week':
      start.setDate(start.getDate() - count * 7)
      // Monday of that week (ADR-028 / query.go weekStart).
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
      break
    case 'month':
      start.setMonth(start.getMonth() - count)
      start.setDate(1)
      break
    case 'year':
      start.setFullYear(start.getFullYear() - count)
      start.setMonth(0, 1)
      break
  }

  return { from: toLocalISODate(start), to }
}

/** Axis label and tooltip label for one bucket, by bucket size. */
export function bucketLabels(
  period: StatsPeriod,
  iso: string
): { label: string; fullLabel: string } {
  const date = fromLocalISODate(iso)
  const month = date.toLocaleDateString(undefined, { month: 'short' })

  switch (period) {
    case 'day':
      return {
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        fullLabel: date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      }
    case 'week':
      return {
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        fullLabel: `Week of ${month} ${date.getDate()}, ${date.getFullYear()}`,
      }
    case 'month':
      return { label: month, fullLabel: `${month} ${date.getFullYear()}` }
    case 'year':
      return { label: String(date.getFullYear()), fullLabel: String(date.getFullYear()) }
  }
}

/**
 * Lookups per 1,000 words read, or null when the bucket is too thin to say.
 *
 * Returning null rather than 0 matters: zero would plot a point claiming the
 * user looked nothing up, which is the opposite of "we don't know".
 */
export function lookupDensity(
  point: StatsPoint,
  period: StatsPeriod
): number | null {
  const words = point.totals.wordsRead
  if (words < DENSITY_MIN_WORDS[period]) return null
  return Math.round((point.totals.wordLookups / words) * 1000 * 10) / 10
}

/**
 * Renders an inferred word count at the precision it actually has.
 *
 * Reading volume is estimated from click and scroll positions, so printing
 * "1,237" would claim a precision the measurement never had and invite the
 * user to read a 40-word difference as meaningful (ADR-028 Decision 8).
 */
export function approximateWords(words: number): string {
  if (words <= 0) return '0'
  if (words < 100) return '<100'
  const magnitude = words < 10_000 ? 100 : 1_000
  return (Math.round(words / magnitude) * magnitude).toLocaleString()
}
