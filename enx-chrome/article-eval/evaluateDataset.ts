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
import { evaluateSnapshot } from './evaluateSnapshot.ts'

/** Dataset formats stop at the loader; evaluation and reporting are shared. */
export async function evaluateDataset(
  loader: DatasetLoader,
  { headed = false, only = '', nonArticle = false } = {}
): Promise<string> {
  const items = (await loader.load()).filter(item => item.url.includes(only))
  const probeScript = await buildProbe()
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
          })
        } finally {
          await context.close()
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
    await browser.close()
  }
}
