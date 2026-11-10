import { chromium, devices } from '@playwright/test'
import {
  measureDataset,
  type DatasetLoader,
} from '../src/lib/articleEval/dataset.ts'
import {
  formatDatasetReport,
  formatNonArticleReport,
} from '../src/lib/articleEval/report.ts'
import { buildProbe } from './buildProbe.ts'
import { closeWithin, PAGE_TIMEOUT_MS } from './deadline.ts'
import { evaluateSnapshot } from './evaluateSnapshot.ts'

/** Dataset formats stop at the loader; evaluation and reporting are shared. */
export async function evaluateDataset(
  loader: DatasetLoader,
  {
    headed = false,
    only = '',
    nonArticle = false,
    timeoutMs = PAGE_TIMEOUT_MS,
    probeScript: givenProbeScript,
  }: {
    headed?: boolean
    only?: string
    nonArticle?: boolean
    /** Per-page budget for loading, probing and closing. */
    timeoutMs?: number
    /** Defaults to buildProbe(). */
    probeScript?: string
  } = {}
): Promise<string> {
  const items = (await loader.load()).filter(item => item.url.includes(only))
  const probeScript = givenProbeScript ?? (await buildProbe())
  const browser = await chromium.launch({
    headless: !headed,
    executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
  })
  try {
    const rows = await measureDataset(
      items,
      async item => {
        const context = await browser.newContext({
          ...devices['Desktop Chrome'],
          serviceWorkers: 'block',
        })
        try {
          return await evaluateSnapshot(await context.newPage(), item, {
            probeScript,
            timeoutMs,
          })
        } finally {
          await closeWithin(() => context.close(), timeoutMs)
        }
      },
      {
        requireLabel: !nonArticle,
        onRow: (row, done) =>
          console.error(
            `[${done}/${items.length}] ${nonArticle ? (row.fallback ? 'layer 6' : (row.source ?? row.ours.verdict)) : row.ours.verdict}  ${row.url}`
          ),
      }
    )
    return nonArticle ? formatNonArticleReport(rows) : formatDatasetReport(rows)
  } finally {
    await closeWithin(() => browser.close(), timeoutMs)
  }
}
