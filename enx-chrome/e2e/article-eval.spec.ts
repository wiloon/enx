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
