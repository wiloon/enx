// ADR-070: the article-eval baseline, and what changed against it.
// Imports nothing but types (see score.ts).

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

function moved(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return before !== after
  return Math.abs(before - after) > SCORE_TOLERANCE
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
