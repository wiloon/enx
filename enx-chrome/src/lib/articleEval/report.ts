// ADR-070: the article-eval report: one row per corpus page, then counts per
// verdict and category, then the changes against the baseline.
// Imports nothing but types (see score.ts).

import type { BaselineChange, BaselineEntry } from './baseline'
import type { Score, Verdict } from './score'

export const VERDICTS: readonly Verdict[] = [
  'ok',
  'misses text',
  'too broad',
  'whole page',
  'no article node',
  'no reference',
  'load failed',
]

export interface PageReport extends Score {
  url: string
  category: string
  /** The site adapter; null when the page didn't load. */
  adapter: string | null
  /** The selector whose matches are the article; null when none matched. */
  selector: string | null
  /** The platform rule that found the article; null for any other result. */
  platform: string | null
  source: 'article' | 'whole-page' | null
  /** Set when layer 6 (ADR-077) found the article rather than a selector. */
  fallback?: 'json-ld-readability'
  /** Why the page failed to load. */
  error?: string
}

export interface Summary {
  total: number
  /** Pages with both scores; the means are over these only. */
  scored: number
  meanCoverage: number | null
  meanPrecision: number | null
  verdicts: Record<Verdict, number>
}

export interface CategorySummary extends Summary {
  category: string
}

function summarizeRows(rows: Score[]): Summary {
  const verdicts = Object.fromEntries(VERDICTS.map(v => [v, 0])) as Record<
    Verdict,
    number
  >
  for (const row of rows) verdicts[row.verdict]++
  const scored = rows.filter(
    row => row.coverage !== null && row.precision !== null
  )
  const mean = (values: number[]) =>
    values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length
  return {
    total: rows.length,
    scored: scored.length,
    meanCoverage: mean(scored.map(row => row.coverage as number)),
    meanPrecision: mean(scored.map(row => row.precision as number)),
    verdicts,
  }
}

export function summarize(
  rows: PageReport[]
): Summary & { categories: CategorySummary[] } {
  const categories = [...new Set(rows.map(row => row.category))]
  return {
    ...summarizeRows(rows),
    categories: categories.map(category => ({
      category,
      ...summarizeRows(rows.filter(row => row.category === category)),
    })),
  }
}

const score = (value: number | null) =>
  value === null ? 'n/a' : value.toFixed(2)

const entry = (value: BaselineEntry | null) =>
  value === null
    ? '(none)'
    : `${value.verdict} ${score(value.coverage)}/${score(value.precision)}`

function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map(row => row[column].length))
  )
  return rows.map(row =>
    row
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd()
  )
}

function counts(verdicts: Record<Verdict, number>): string {
  return VERDICTS.map(verdict => `${verdict} ${verdicts[verdict]}`).join(', ')
}

function summaryLine(summary: Summary): string {
  return (
    `${summary.total} pages, ${summary.scored} scored, ` +
    `mean coverage ${score(summary.meanCoverage)}, ` +
    `mean precision ${score(summary.meanPrecision)}; ${counts(summary.verdicts)}`
  )
}

/** `changes` is null when there is no baseline to compare against. */
export function formatReport(
  rows: PageReport[],
  changes: BaselineChange[] | null
): string {
  const lines = table([
    [
      'URL',
      'CATEGORY',
      'ADAPTER/SELECTOR',
      'PLATFORM',
      'SOURCE',
      'COVERAGE',
      'PRECISION',
      'VERDICT',
    ],
    ...rows.map(row => [
      row.url,
      row.category,
      row.adapter === null
        ? 'n/a'
        : `${row.adapter} ${row.selector ?? '(no selector)'}`,
      row.platform ?? '-',
      row.fallback ? `${row.source} (layer 6)` : (row.source ?? 'n/a'),
      score(row.coverage),
      score(row.precision),
      row.error ? `${row.verdict} (${row.error})` : row.verdict,
    ]),
  ])

  const summary = summarize(rows)
  lines.push('', `All: ${summaryLine(summary)}`)
  for (const category of summary.categories) {
    lines.push(`${category.category}: ${summaryLine(category)}`)
  }

  // Listed whatever the baseline says: a failed page's last good entry may be
  // kept in the baseline, but this run measured nothing for it.
  const failed = rows.filter(row => row.verdict === 'load failed')
  if (failed.length > 0) {
    lines.push(
      '',
      `Unmeasured: ${failed.length} ${failed.length === 1 ? 'page' : 'pages'} failed to load`,
      ...table(failed.map(row => [row.url, row.error ?? ''])).map(
        line => `  ${line}`
      )
    )
  }

  if (changes !== null) {
    lines.push('')
    if (changes.length === 0) {
      lines.push('No changes since the baseline.')
    } else {
      lines.push(`Changes since the baseline (${changes.length}):`)
      lines.push(
        ...table(
          changes.map(change => [
            change.change,
            change.url,
            `${entry(change.before)} -> ${entry(change.after)}`,
          ])
        ).map(line => `  ${line}`)
      )
    }
  }
  return lines.join('\n')
}

/** Both extractors are scored against the same human label, never each other. */
export interface DatasetReport {
  id: string
  url: string
  /** The dataset's page type; untyped datasets get no page type summaries. */
  pageType?: string
  ours: Score
  readability: Score
  /** Where our lookup area came from; unset when the page is unmeasured. */
  source?: 'article' | 'whole-page'
  /** Set when layer 6 (ADR-077) found the article rather than a selector. */
  fallback?: 'json-ld-readability'
  /** Why the page is unmeasured. */
  error?: string
}

function extractorSummaries(rows: DatasetReport[], prefix = ''): string[] {
  return [
    `${prefix}Ours: ${summaryLine(summarizeRows(rows.map(row => row.ours)))}`,
    `${prefix}Readability: ${summaryLine(summarizeRows(rows.map(row => row.readability)))}`,
  ]
}

export function formatDatasetReport(rows: DatasetReport[]): string {
  const pageTypes = [
    ...new Set(rows.flatMap(row => (row.pageType ? [row.pageType] : []))),
  ]
  const typed = pageTypes.length > 0
  const lines = table([
    [
      'ID',
      'URL',
      ...(typed ? ['PAGE TYPE'] : []),
      'OUR COVERAGE',
      'OUR PRECISION',
      'OUR VERDICT',
      'READABILITY COVERAGE',
      'READABILITY PRECISION',
      'READABILITY VERDICT',
    ],
    ...rows.map(row => [
      row.id,
      row.url,
      ...(typed ? [row.pageType ?? '-'] : []),
      score(row.ours.coverage),
      score(row.ours.precision),
      row.ours.verdict,
      score(row.readability.coverage),
      score(row.readability.precision),
      row.readability.verdict,
    ]),
  ])
  lines.push('', ...extractorSummaries(rows))
  for (const pageType of pageTypes) {
    lines.push(
      ...extractorSummaries(
        rows.filter(row => row.pageType === pageType),
        `${pageType}: `
      )
    )
  }
  const layer6 = rows.filter(row => row.fallback !== undefined)
  if (layer6.length > 0) {
    const count = (verdict: Verdict) =>
      layer6.filter(row => row.ours.verdict === verdict).length
    lines.push(
      `Layer 6: ${layer6.length} pages; ok ${count('ok')}, ` +
        `misses text ${count('misses text')}, too broad ${count('too broad')}`
    )
  }
  lines.push(...rows.filter(row => row.error).map(unmeasuredLine))
  return lines.join('\n')
}

function unmeasuredLine(row: DatasetReport): string {
  if (!row.url) {
    const where = [row.id, `(${row.error})`, row.pageType]
    return `Unmeasured: ${where.filter(Boolean).join(' ')}`
  }
  const where = [row.id, row.url, row.pageType].filter(Boolean).join(' ')
  return `Unmeasured: ${where} (${row.error})`
}

function nodeCounts(rows: DatasetReport[]): string {
  const measured = rows.filter(row => row.source !== undefined)
  const layer6 = measured.filter(row => row.fallback !== undefined).length
  const wholePage = measured.filter(row => row.source === 'whole-page').length
  return (
    `${rows.length} pages, ${measured.length} measured, ` +
    `${rows.length - measured.length} unmeasured; ` +
    `selector node ${measured.length - layer6 - wholePage}, ` +
    `layer 6 node ${layer6}, whole page ${wholePage}`
  )
}

/**
 * Non-article pages have no article to score: what matters is whether
 * detection gives them an article node at all, and which layer did
 * (ADR-077's negative set).
 */
export function formatNonArticleReport(rows: DatasetReport[]): string {
  const pageTypes = [...new Set(rows.map(row => row.pageType ?? '-'))]
  const lines = [
    ...pageTypes.map(
      pageType =>
        `${pageType}: ${nodeCounts(rows.filter(row => (row.pageType ?? '-') === pageType))}`
    ),
    `All: ${nodeCounts(rows)}`,
  ]
  const layer6 = rows.filter(row => row.fallback !== undefined)
  lines.push('', `Layer 6 nodes (${layer6.length}):`)
  if (layer6.length > 0) {
    lines.push(
      ...table(layer6.map(row => [row.id, row.url, row.pageType ?? '-'])).map(
        line => `  ${line}`
      )
    )
  }
  lines.push(...rows.filter(row => row.error).map(unmeasuredLine))
  return lines.join('\n')
}
