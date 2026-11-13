// ADR-070: measure article detection on the live site corpus.
//
//   task article-eval                        report, compared with the baseline
//   task article-eval -- --update-baseline   also rewrite baseline.json
//   task article-eval -- --headed            show the browser
//   task article-eval -- --only <url part>   just the matching corpus pages
//
// --dataset zyte|wcxb evaluates cached snapshots against labels: Zyte's
// articleBody, or WCXB's article and documentation pages. --dataset
// wcxb-negative counts which WCXB non-article pages get an article node
// (ADR-077).
// Live sites or a downloaded dataset, so never in CI. A page that fails to load is reported as
// `load failed` and doesn't fail the run.

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { chromium, devices } from '@playwright/test'
import {
  comparableBaseline,
  compareBaseline,
  formatBaseline,
  mergeBaseline,
  toBaseline,
  type Baseline,
} from '../src/lib/articleEval/baseline.ts'
import type { CorpusEntry } from '../src/lib/articleEval/corpus.ts'
import { formatReport, type PageReport } from '../src/lib/articleEval/report.ts'
import { buildProbe } from './buildProbe.ts'
import { closeContextWithin, closeWithin, PAGE_TIMEOUT_MS } from './deadline.ts'
import { evaluatePage } from './evaluatePage.ts'
import { evaluateDataset } from './evaluateDataset.ts'
import { parseArgs, selectDataset } from './options.ts'

const CORPUS = new URL('./corpus.json', import.meta.url)
const BASELINE = new URL('./baseline.json', import.meta.url)
// More parallel pages slow each other past the per-page timeout and draw
// rate limits (Wikipedia answers 429).
const CONCURRENCY = 3

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.dataset) {
    const { header, loader, nonArticle } = selectDataset(options.dataset)
    console.error(header)
    console.log(await evaluateDataset(loader, { ...options, nonArticle }))
    return
  }
  const allPages = JSON.parse(await readFile(CORPUS, 'utf8')) as CorpusEntry[]
  const corpus = allPages.filter(page => page.url.includes(options.only))
  const probeScript = await buildProbe()

  const browser = await chromium.launch({
    headless: !options.headed,
    executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
  })
  const rows: PageReport[] = new Array(corpus.length)
  let next = 0
  const worker = async () => {
    while (next < corpus.length) {
      const index = next++
      // Sites with a strict CSP would block the injected probe.
      const context = await browser.newContext({
        ...devices['Desktop Chrome'],
        bypassCSP: true,
      })
      try {
        rows[index] = await evaluatePage(
          await context.newPage(),
          corpus[index],
          { probeScript }
        )
      } finally {
        await closeContextWithin(context, PAGE_TIMEOUT_MS)
      }
      console.error(
        `[${rows.filter(Boolean).length}/${corpus.length}] ${rows[index].verdict}  ${corpus[index].url}`
      )
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  await closeWithin(() => browser.close(), PAGE_TIMEOUT_MS)

  const current = toBaseline(rows)
  const baseline: Baseline | null = existsSync(BASELINE)
    ? (JSON.parse(await readFile(BASELINE, 'utf8')) as Baseline)
    : null
  // A partial run compares, and updates, only the pages it measured.
  const changes = baseline
    ? compareBaseline(
        comparableBaseline(baseline, current, Boolean(options.only)),
        current
      )
    : null
  console.log(formatReport(rows, changes))

  if (options.updateBaseline) {
    const merged = mergeBaseline(
      baseline,
      current,
      allPages.map(page => page.url)
    )
    await writeFile(BASELINE, formatBaseline(merged))
    console.log(
      `\nUpdated ${Object.keys(current).length} pages in ${BASELINE.pathname}`
    )
  }
}

await main()
