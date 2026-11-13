import type { Page } from '@playwright/test'
import type { ProbeResult } from '../src/articleEval/pageProbe.ts'
import type { DatasetItem } from '../src/lib/articleEval/dataset.ts'
import type { DatasetReport } from '../src/lib/articleEval/report.ts'
import { scorePage } from '../src/lib/articleEval/score.ts'
import { PROBE_GLOBAL } from './buildProbe.ts'
import { prepareProbe, PAGE_TIMEOUT_MS, withDeadline } from './deadline.ts'

/** Use a fresh context with CSP enabled and serviceWorkers: 'block'. */
export async function evaluateSnapshot(
  page: Page,
  item: DatasetItem,
  {
    probeScript,
    timeoutMs = PAGE_TIMEOUT_MS,
  }: {
    probeScript: string
    /** Budget for loading, and again for probing. */
    timeoutMs?: number
  }
): Promise<DatasetReport> {
  // Fragments stay in the page URL but are never part of an HTTP request.
  const navigationUrl = new URL(item.url)
  navigationUrl.hash = ''
  let served = false
  await page.route('**/*', route => {
    const request = route.request()
    if (
      !served &&
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      request.url() === navigationUrl.href
    ) {
      served = true
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        // Static snapshots: inline scripts must not mutate the labelled DOM.
        headers: {
          'Content-Security-Policy': "script-src 'none'; object-src 'none'",
        },
        body: item.html,
      })
    }
    return route.abort()
  })
  try {
    await page.goto(item.url, { waitUntil: 'load', timeout: timeoutMs })
    const observed = await withDeadline(
      (async () => {
        await prepareProbe(page)
        // DevTools evaluation executes our probe even though page scripts are disabled.
        await page.evaluate(probeScript)
        return page.evaluate(name => {
          const api = (
            window as unknown as Record<
              string,
              { probe(): Promise<ProbeResult> }
            >
          )[name]
          return api.probe()
        }, PROBE_GLOBAL)
      })(),
      timeoutMs,
      'probe'
    )
    return {
      id: item.id,
      url: item.url,
      pageType: item.pageType,
      source: observed.source,
      ...(observed.fallback ? { fallback: observed.fallback } : {}),
      ...(observed.layer6Ms === undefined
        ? {}
        : { layer6Ms: observed.layer6Ms }),
      ours: scorePage({
        status: 'loaded',
        ...observed,
        referenceText: item.labelText,
      }),
      readability: scorePage({
        status: 'loaded',
        source: 'article',
        nodes: observed.referenceText ? 1 : 0,
        chosenText: observed.referenceText ?? '',
        referenceText: item.labelText,
      }),
    }
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).split('\n')[0]
    const failed = scorePage({ status: 'load-failed', error: message })
    return {
      id: item.id,
      url: item.url,
      pageType: item.pageType,
      ours: failed,
      readability: failed,
      error: message,
    }
  }
}
