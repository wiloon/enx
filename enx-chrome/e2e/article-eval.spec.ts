// ADR-070: the article-eval tool's browser entry point on local fixture
// pages. A plain page, no extension: the tool injects the extension's own
// detection itself.

import path from 'path'
import { fileURLToPath } from 'url'
import { expect, test } from '@playwright/test'
import { buildProbe } from '../article-eval/buildProbe'
import { evaluatePage } from '../article-eval/evaluatePage'
import { FIXTURE_ORIGIN } from './auth'

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'test-fixtures'
)

let probeScript: string

test.beforeAll(async () => {
  test.setTimeout(60_000)
  probeScript = await buildProbe()
})

const evaluate = (page: import('@playwright/test').Page, url: string) =>
  evaluatePage(page, { url, category: 'fixture' }, { probeScript, settleMs: 0 })

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
    const labelText =
      'Local volunteers walked beside the river early this morning, recording birds and measuring the water after several days of heavy rain. Their observations will help the village understand how the changing seasons affect wildlife along the banks. The team plans to return next month, when the young trees have grown new leaves and the water has settled. Everyone can join the walk, bring a notebook, and share what they learn with the community.'
    const failed: string[] = []
    page.on('requestfailed', request => failed.push(request.url()))
    const url = 'https://snapshot.example.invalid/river#observations'
    const report = await evaluateSnapshot(
      page,
      { id: 'river', url, html, labelText },
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
})
