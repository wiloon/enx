// ADR-070: measure article detection on the live site corpus.
//
//   task article-eval                        report, compared with the baseline
//   task article-eval -- --update-baseline   also rewrite baseline.json
//   task article-eval -- --headed            show the browser
//   task article-eval -- --only <url part>   just the matching corpus pages
//
// Live sites only, so never in CI. A page that fails to load is reported as
// `load failed` and doesn't fail the run.

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { chromium, devices } from '@playwright/test'
import {
  comparableBaseline,
  compareBaseline,
  toBaseline,
  type Baseline,
} from '../src/lib/articleEval/baseline.ts'
import { formatReport, type PageReport } from '../src/lib/articleEval/report.ts'
import { buildProbe } from './buildProbe.ts'
import { evaluatePage, type CorpusPage } from './evaluatePage.ts'

const CORPUS = new URL('./corpus.json', import.meta.url)
const BASELINE = new URL('./baseline.json', import.meta.url)
// More parallel pages slow each other past the per-page timeout and draw
// rate limits (Wikipedia answers 429).
const CONCURRENCY = 3

function parseArgs(args: string[]) {
  const options = { updateBaseline: false, headed: false, only: '' }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--update-baseline') options.updateBaseline = true
    else if (args[i] === '--headed') options.headed = true
    else if (args[i] === '--only' && args[i + 1]) options.only = args[++i]
    else throw new Error(`unknown argument: ${args[i]}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const allPages = JSON.parse(await readFile(CORPUS, 'utf8')) as CorpusPage[]
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
      const page = await context.newPage()
      rows[index] = await evaluatePage(page, corpus[index], { probeScript })
      await context.close()
      console.error(
        `[${rows.filter(Boolean).length}/${corpus.length}] ${rows[index].verdict}  ${corpus[index].url}`
      )
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  await browser.close()

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
    // Pages no longer in the corpus drop out; the file follows corpus order.
    // One line per page, so a diff shows which pages moved.
    const merged: Baseline = { ...baseline, ...current }
    const lines = allPages
      .filter(page => page.url in merged)
      .map(
        page =>
          `  ${JSON.stringify(page.url)}: ${JSON.stringify(merged[page.url])}`
      )
    await writeFile(BASELINE, `{\n${lines.join(',\n')}\n}\n`)
    console.log(
      `\nUpdated ${Object.keys(current).length} pages in ${BASELINE.pathname}`
    )
  }
}

await main()
