// ADR-070: the article-eval baseline, and what changed against it.
// Imports nothing but types (see score.ts).

import type { PageReport } from './report'
import type { Score } from './score'

/** A page's recorded scores; the baseline file may carry more fields. */
export type BaselineEntry = Score

/** Recorded scores by page URL. */
export type Baseline = Record<string, BaselineEntry>

/** A score has moved when it changed by more than this. */
export const SCORE_TOLERANCE = 0.05

export interface BaselineChange {
  url: string
  change: 'added' | 'removed' | 'verdict' | 'scores'
  before: BaselineEntry | null
  after: BaselineEntry | null
}

const round = (value: number | null) =>
  value === null ? null : Math.round(value * 1000) / 1000

/** A run's rows as the entries the baseline file records. */
export function toBaseline(rows: PageReport[]): Baseline {
  return Object.fromEntries(
    rows.map(row => [
      row.url,
      {
        category: row.category,
        adapter: row.adapter,
        selector: row.selector,
        platform: row.platform,
        source: row.source,
        verdict: row.verdict,
        coverage: round(row.coverage),
        precision: round(row.precision),
      },
    ])
  )
}

/**
 * The baseline `--update-baseline` writes, in corpus order. Pages no longer
 * in the corpus drop out, and pages a partial run didn't measure keep their
 * entry. A page that failed to load keeps its last entry that loaded, so a
 * blocked or flaky site doesn't erase its last good scores.
 */
export function mergeBaseline(
  previous: Baseline | null,
  current: Baseline,
  corpusUrls: string[]
): Baseline {
  const merged: Baseline = {}
  for (const url of corpusUrls) {
    const before = previous?.[url]
    const after = current[url]
    const entry =
      after?.verdict === 'load failed' &&
      before &&
      before.verdict !== 'load failed'
        ? before
        : (after ?? before)
    if (entry) merged[url] = entry
  }
  return merged
}

/** The baseline file: one line per page, so a diff shows which pages moved. */
export function formatBaseline(baseline: Baseline): string {
  const lines = Object.entries(baseline).map(
    ([url, entry]) => `  ${JSON.stringify(url)}: ${JSON.stringify(entry)}`
  )
  return `{\n${lines.join(',\n')}\n}\n`
}

function moved(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return before !== after
  return Math.abs(before - after) > SCORE_TOLERANCE
}

/**
 * The baseline entries a run compares against. A partial (`--only`) run
 * measured only some pages, so the rest are not reported as removed.
 */
export function comparableBaseline(
  baseline: Baseline,
  current: Baseline,
  partial: boolean
): Baseline {
  if (!partial) return baseline
  return Object.fromEntries(
    Object.entries(baseline).filter(([url]) => url in current)
  )
}

export function compareBaseline(
  baseline: Baseline,
  current: Baseline
): BaselineChange[] {
  const urls = [...new Set([...Object.keys(baseline), ...Object.keys(current)])]
  const changes: BaselineChange[] = []
  for (const url of urls.sort()) {
    const before = baseline[url] ?? null
    const after = current[url] ?? null
    if (!before) {
      changes.push({ url, change: 'added', before, after })
    } else if (!after) {
      changes.push({ url, change: 'removed', before, after })
    } else if (before.verdict !== after.verdict) {
      changes.push({ url, change: 'verdict', before, after })
    } else if (
      moved(before.coverage, after.coverage) ||
      moved(before.precision, after.precision)
    ) {
      changes.push({ url, change: 'scores', before, after })
    }
  }
  return changes
}
