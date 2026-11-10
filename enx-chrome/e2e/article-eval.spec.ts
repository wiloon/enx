// ADR-070: the article-eval tool's browser entry point on local fixture
// pages. A plain page, no extension: the tool injects the extension's own
// detection itself.

import { readFile } from 'node:fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { expect, test } from '@playwright/test'
import { buildProbe, PROBE_GLOBAL } from '../article-eval/buildProbe'
import { closeWithin, withDeadline } from '../article-eval/deadline'
import { evaluateDataset } from '../article-eval/evaluateDataset'
import { evaluatePage } from '../article-eval/evaluatePage'
import { evaluateSnapshot } from '../article-eval/evaluateSnapshot'
import { FIXTURE_ORIGIN } from './auth'

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'test-fixtures'
)

const ARTICLE_LABEL =
  'Local volunteers walked beside the river early this morning, recording birds and measuring the water after several days of heavy rain. Their observations will help the village understand how the changing seasons affect wildlife along the banks. The team plans to return next month, when the young trees have grown new leaves and the water has settled. Everyone can join the walk, bring a notebook, and share what they learn with the community.'

let probeScript: string

test.beforeAll(async () => {
  test.setTimeout(60_000)
  probeScript = await buildProbe()
})

const evaluate = (page: import('@playwright/test').Page, url: string) =>
  evaluatePage(page, { url, category: 'docs' }, { probeScript, settleMs: 0 })

test.describe('article-eval', () => {
  test('an article page records the article selector and scores in range', async ({
    page,
  }) => {
    const report = await evaluate(
      page,
      `${FIXTURE_ORIGIN}/article-eval-article.html`
    )

    expect(report).toMatchObject({
      adapter: 'default',
      selector: 'article',
      platform: null,
      source: 'article',
      verdict: 'ok',
    })
    for (const score of [report.coverage, report.precision]) {
      expect(score).toBeGreaterThanOrEqual(0.7)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  test('a Docusaurus page records the platform selector and the platform', async ({
    page,
  }) => {
    const report = await evaluate(
      page,
      `${FIXTURE_ORIGIN}/article-eval-docusaurus.html`
    )

    expect(report).toMatchObject({
      adapter: 'default',
      selector: '.theme-doc-markdown',
      platform: 'docusaurus',
      source: 'article',
    })
  })

  test('a page with no article records the whole page', async ({ page }) => {
    const report = await evaluate(
      page,
      `${FIXTURE_ORIGIN}/article-eval-no-article.html`
    )

    expect(report).toMatchObject({
      adapter: 'default',
      selector: null,
      platform: null,
      source: 'whole-page',
      coverage: 0,
      precision: null,
      verdict: 'whole page',
    })
  })

  test('a page Readability finds no article in records no reference', async ({
    page,
  }) => {
    const report = await evaluate(
      page,
      `${FIXTURE_ORIGIN}/article-eval-hidden-article.html`
    )

    expect(report).toMatchObject({
      selector: 'article',
      platform: null,
      source: 'article',
      coverage: null,
      precision: null,
      verdict: 'no reference',
    })
  })

  test('an adapter selector miss records no article node', async ({ page }) => {
    const url = 'https://en.wikipedia.org/wiki/Article_eval_fixture'
    await page.route('https://en.wikipedia.org/**', route =>
      route.request().url() === url
        ? route.fulfill({
            path: path.join(FIXTURES, 'article-eval-wikipedia-miss.html'),
            contentType: 'text/html; charset=utf-8',
          })
        : route.fulfill({ status: 404 })
    )

    const report = await evaluate(page, url)

    expect(report).toMatchObject({
      adapter: 'wikipedia',
      selector: null,
      platform: null,
      source: 'article',
      coverage: 0,
      precision: 0,
      verdict: 'no article node',
    })
  })

  test('a page that fails to load records load failed', async ({ page }) => {
    const report = await evaluate(
      page,
      `${FIXTURE_ORIGIN}/article-eval-does-not-exist.html`
    )

    expect(report).toMatchObject({
      adapter: null,
      platform: null,
      source: null,
      coverage: null,
      precision: null,
      verdict: 'load failed',
      error: 'HTTP 404',
    })
  })
})

test.describe('labelled offline snapshots', () => {
  test('serves a snapshot at its labelled URL and blocks resources and scripts', async ({
    page,
  }) => {
    const { readFile } = await import('node:fs/promises')
    const { evaluateSnapshot } =
      await import('../article-eval/evaluateSnapshot')
    const html = await readFile(
      path.join(FIXTURES, 'article-eval-labelled.html'),
      'utf8'
    )
    const labelText = ARTICLE_LABEL
    const failed: string[] = []
    page.on('requestfailed', request => failed.push(request.url()))
    const url = 'https://snapshot.example.invalid/river#observations'
    const report = await evaluateSnapshot(
      page,
      { id: 'river', url, html, labelText, pageType: 'article' },
      { probeScript }
    )
    expect(page.url()).toBe(url)
    expect(await page.locator('article').innerText()).toContain(
      'Local volunteers'
    )
    expect(await page.locator('body').innerText()).not.toContain(
      'Inline script must not run'
    )
    expect(failed).toContain('https://assets.example.invalid/photo.jpg')
    expect(failed).toContain('https://assets.example.invalid/frame')
    expect(report).toMatchObject({
      id: 'river',
      url,
      pageType: 'article',
      ours: { coverage: 1, precision: 1, verdict: 'ok' },
      readability: { coverage: 1, precision: 1, verdict: 'ok' },
    })
    // The snapshot is fulfilled only for its top-level navigation.
    expect(
      await page.evaluate(async url => {
        try {
          await fetch(url)
          return 'escaped'
        } catch {
          return 'blocked'
        }
      }, url)
    ).toBe('blocked')
  })

  test('shows Readability missing text even when our selection matches the label', async ({
    page,
  }) => {
    const { readFile } = await import('node:fs/promises')
    const { evaluateSnapshot } =
      await import('../article-eval/evaluateSnapshot')
    const html = await readFile(
      path.join(FIXTURES, 'article-eval-labelled-miss.html'),
      'utf8'
    )
    const report = await evaluateSnapshot(
      page,
      {
        id: 'station',
        url: 'https://snapshot.example.invalid/station',
        html,
        labelText: 'The station recorded five quiet nights.',
      },
      { probeScript }
    )
    expect(report).toMatchObject({
      ours: { coverage: 1, precision: 1, verdict: 'ok' },
      readability: { coverage: 0, precision: 0, verdict: 'no article node' },
    })
  })

  test('a snapshot whose probe fails is unmeasured and keeps its page type', async ({
    page,
  }) => {
    const { evaluateSnapshot } =
      await import('../article-eval/evaluateSnapshot')
    const report = await evaluateSnapshot(
      page,
      {
        id: 'broken',
        url: 'https://snapshot.example.invalid/broken',
        html: '<article>Broken probe</article>',
        labelText: 'Broken probe',
        pageType: 'documentation',
      },
      { probeScript: 'throw new Error("probe broke")' }
    )
    expect(report).toMatchObject({
      id: 'broken',
      pageType: 'documentation',
      ours: { verdict: 'load failed' },
      readability: { verdict: 'load failed' },
    })
    expect(report.error).toContain('probe broke')
  })
})

// A probe stuck in a synchronous loop blocks its renderer, so these tests use
// their own contexts and close them within a budget.
const STUCK_PROBE = `window.${PROBE_GLOBAL} = {
  readySelector: () => null,
  probe: () => { for (;;) {} },
}`
const BUDGET_MS = 2_000

test.describe('a probe that never returns', () => {
  test('a live page is load failed once the probe outruns its budget', async ({
    browser,
  }) => {
    const context = await browser.newContext()
    try {
      const started = Date.now()
      const report = await evaluatePage(
        await context.newPage(),
        {
          url: `${FIXTURE_ORIGIN}/article-eval-article.html`,
          category: 'docs',
        },
        { probeScript: STUCK_PROBE, settleMs: 0, timeoutMs: BUDGET_MS }
      )
      expect(Date.now() - started).toBeLessThan(BUDGET_MS * 5)
      expect(report).toMatchObject({ verdict: 'load failed' })
      expect(report.error).toContain('probe timed out')
    } finally {
      await closeWithin(() => context.close(), BUDGET_MS)
    }
  })

  test('a page whose ready selector never appears is still probed and measured', async ({
    browser,
  }) => {
    const neverAppears = `${probeScript}
;(() => {
  const real = window.${PROBE_GLOBAL}
  window.${PROBE_GLOBAL} = {
    readySelector: () => '#never-appears',
    probe: () => real.probe(),
  }
})()`
    const context = await browser.newContext()
    try {
      const started = Date.now()
      const report = await evaluatePage(
        await context.newPage(),
        {
          url: `${FIXTURE_ORIGIN}/article-eval-article.html`,
          category: 'docs',
        },
        { probeScript: neverAppears, settleMs: 0, timeoutMs: BUDGET_MS }
      )
      expect(Date.now() - started).toBeLessThan(BUDGET_MS * 5)
      expect(report.verdict).not.toBe('load failed')
      expect(report.error).toBeUndefined()
    } finally {
      await closeWithin(() => context.close(), BUDGET_MS)
    }
  })

  test('a snapshot is unmeasured and keeps its page type once the probe outruns its budget', async ({
    browser,
  }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    try {
      const started = Date.now()
      const report = await evaluateSnapshot(
        await context.newPage(),
        {
          id: 'stuck',
          url: 'https://snapshot.example.invalid/stuck',
          html: '<article>Stuck probe</article>',
          labelText: 'Stuck probe',
          pageType: 'documentation',
        },
        { probeScript: STUCK_PROBE, timeoutMs: BUDGET_MS }
      )
      expect(Date.now() - started).toBeLessThan(BUDGET_MS * 5)
      expect(report).toMatchObject({
        id: 'stuck',
        pageType: 'documentation',
        ours: { verdict: 'load failed' },
        readability: { verdict: 'load failed' },
      })
      expect(report.error).toContain('probe timed out')
    } finally {
      await closeWithin(() => context.close(), BUDGET_MS)
    }
  })

  test('a dataset run closes the stuck pages and measures the next one', async () => {
    test.setTimeout(60_000)
    const html = await readFile(
      path.join(FIXTURES, 'article-eval-labelled.html'),
      'utf8'
    )
    // More stuck pages than workers, so a worker must move past one.
    const stuck = ['stuck-1', 'stuck-2', 'stuck-3'].map(id => ({
      id,
      url: `https://snapshot.example.invalid/stuck/${id}`,
      html: '<article>Stuck probe</article>',
      labelText: 'Stuck probe',
    }))
    const next = {
      id: 'next',
      url: 'https://snapshot.example.invalid/river',
      html,
      labelText: ARTICLE_LABEL,
    }
    const stuckOnStuckPaths = `${probeScript}
;(() => {
  const real = window.${PROBE_GLOBAL}
  window.${PROBE_GLOBAL} = {
    readySelector: () => real.readySelector(),
    probe: () => {
      if (location.pathname.startsWith('/stuck/')) for (;;) {}
      return real.probe()
    },
  }
})()`

    const report = await evaluateDataset(
      { load: async () => [...stuck, next] },
      { probeScript: stuckOnStuckPaths, timeoutMs: BUDGET_MS }
    )

    for (const { id } of stuck) {
      expect(report).toMatch(new RegExp(`^${id}\\s.*load failed`, 'm'))
    }
    expect(report).toMatch(/^next\s.*\bok\s*$/m)
  })
})

test.describe('the deadline on browser operations', () => {
  test('a probe that settles in time keeps its result and clears its timer', async () => {
    const realSetTimeout = globalThis.setTimeout
    const realClearTimeout = globalThis.clearTimeout
    const set: unknown[] = []
    const cleared: unknown[] = []
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      const timer = realSetTimeout(...args)
      set.push(timer)
      return timer
    }) as typeof setTimeout
    globalThis.clearTimeout = ((timer: Parameters<typeof clearTimeout>[0]) => {
      cleared.push(timer)
      realClearTimeout(timer)
    }) as typeof clearTimeout
    try {
      expect(
        await withDeadline(Promise.resolve('probed'), BUDGET_MS, 'probe')
      ).toBe('probed')
    } finally {
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    }
    expect(set).toHaveLength(1)
    expect(cleared).toEqual(set)
  })

  test('a close that rejects, never settles or rejects late returns within its budget', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const closes: Array<() => Promise<void>> = [
        () => Promise.reject(new Error('close failed')),
        () => {
          throw new Error('close threw')
        },
        () => new Promise<void>(() => {}),
        () =>
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('late close')), 400)
          ),
      ]
      for (const close of closes) {
        const started = Date.now()
        await closeWithin(close, 200)
        expect(Date.now() - started).toBeLessThan(1_000)
      }
      // Let the late rejection land after its close was abandoned.
      await new Promise(resolve => setTimeout(resolve, 500))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
