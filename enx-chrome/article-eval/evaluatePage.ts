// One corpus page through the extension's own article detection and
// Readability, scored (ADR-070).

import type { Page } from '@playwright/test'
import type { ProbeResult } from '../src/articleEval/pageProbe.ts'
import type { CorpusEntry } from '../src/lib/articleEval/corpus.ts'
import type { PageReport } from '../src/lib/articleEval/report.ts'
import { scorePage } from '../src/lib/articleEval/score.ts'
import { PROBE_GLOBAL } from './buildProbe.ts'

export type CorpusPage = Pick<CorpusEntry, 'url' | 'category'>

export interface EvaluateOptions {
  /** The IIFE buildProbe() returns. */
  probeScript: string
  /** Per-page budget for loading and waiting. */
  timeoutMs?: number
  /** Wait after `load` for late-rendered content. */
  settleMs?: number
}

type ProbeApi = {
  probe: () => Promise<ProbeResult>
  readySelector: () => string | null
}

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]

export async function evaluatePage(
  page: Page,
  { url, category }: CorpusPage,
  { probeScript, timeoutMs = 30_000, settleMs = 2_000 }: EvaluateOptions
): Promise<PageReport> {
  const loadFailed = (error: string): PageReport => ({
    url,
    category,
    adapter: null,
    selector: null,
    platform: null,
    source: null,
    ...scorePage({ status: 'load-failed', error }),
    error,
  })

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    })
    if (!response) return loadFailed('no response')
    if (!response.ok()) return loadFailed(`HTTP ${response.status()}`)
  } catch (error) {
    return loadFailed(firstLine(error))
  }
  // Ad-heavy pages can keep `load` waiting on third-party requests long after
  // the article is in the DOM: measure them anyway.
  await page
    .waitForLoadState('load', { timeout: timeoutMs })
    .catch(() => undefined)

  let probed: ProbeResult
  try {
    await page.waitForTimeout(settleMs)
    await page.addScriptTag({ content: probeScript })
    const ready = await page.evaluate(
      name =>
        (window as unknown as Record<string, ProbeApi>)[name].readySelector(),
      PROBE_GLOBAL
    )
    if (ready) {
      await page
        .waitForSelector(ready, { timeout: timeoutMs })
        .catch(() => undefined)
    }
    probed = await page.evaluate(
      name => (window as unknown as Record<string, ProbeApi>)[name].probe(),
      PROBE_GLOBAL
    )
  } catch (error) {
    // A page that navigates away or blocks the script mid-probe.
    return loadFailed(`probe failed: ${firstLine(error)}`)
  }

  return {
    url,
    category,
    adapter: probed.adapter,
    selector: probed.selector,
    platform: probed.platform,
    source: probed.source,
    ...(probed.fallback ? { fallback: probed.fallback } : {}),
    ...scorePage({ status: 'loaded', ...probed }),
  }
}
