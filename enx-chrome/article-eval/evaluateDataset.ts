import { chromium, devices } from '@playwright/test'
import type { DatasetLoader } from '../src/lib/articleEval/dataset.ts'
import {
  formatDatasetReport,
  type DatasetReport,
} from '../src/lib/articleEval/report.ts'
import { buildProbe } from './buildProbe.ts'
import { evaluateSnapshot } from './evaluateSnapshot.ts'

/** Dataset formats stop at the loader; evaluation and reporting are shared. */
export async function evaluateDataset(
  loader: DatasetLoader,
  { headed = false, only = '' } = {}
): Promise<string> {
  const items = (await loader.load()).filter(item => item.url.includes(only))
  const probeScript = await buildProbe()
  const browser = await chromium.launch({
    headless: !headed,
    executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
  })
  const rows: DatasetReport[] = new Array(items.length)
  let next = 0
  try {
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < items.length) {
          const index = next++
          const context = await browser.newContext({
            ...devices['Desktop Chrome'],
            serviceWorkers: 'block',
          })
          try {
            rows[index] = await evaluateSnapshot(
              await context.newPage(),
              items[index],
              { probeScript }
            )
          } finally {
            await context.close()
          }
          console.error(
            `[${rows.filter(Boolean).length}/${items.length}] ${rows[index].ours.verdict}  ${items[index].url}`
          )
        }
      })
    )
  } finally {
    await browser.close()
  }
  return formatDatasetReport(rows)
}
