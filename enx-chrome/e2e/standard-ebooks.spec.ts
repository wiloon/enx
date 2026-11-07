// Standard Ebooks text pages: the body matter (EPUB type `bodymatter`) is
// the article. The fixtures are hand-written XHTML in the real pages' shape,
// served for https://standardebooks.org as application/xhtml+xml so
// `epub:type` is a namespaced attribute, as on the real site.

import path from 'path'
import { fileURLToPath } from 'url'
import type { BrowserContext, Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  enableLearningMode,
  getHighlightedWords,
  mockBackendFetch,
  waitForContentScript,
} from './helpers'

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'test-fixtures'
)
const BOOK = 'https://standardebooks.org/ebooks/carolyn-wells/the-gold-bag'
const PAGES: Record<string, string> = {
  [`${BOOK}/text/single-page`]: 'standard-ebooks-single-page.xhtml',
  [`${BOOK}/text/chapter-1`]: 'standard-ebooks-chapter.xhtml',
  [`${BOOK}/text/imprint`]: 'standard-ebooks-imprint.xhtml',
  'https://standardebooks.org/ebooks/edgar-allan-poe/short-fiction/text/single-page':
    'standard-ebooks-collection.xhtml',
}

async function serveStandardEbooks(context: BrowserContext) {
  await context.route('https://standardebooks.org/**', route => {
    const fixture = PAGES[route.request().url()]
    if (!fixture) return route.fulfill({ status: 404 })
    return route.fulfill({
      path: path.join(FIXTURES, fixture),
      contentType: 'application/xhtml+xml; charset=utf-8',
    })
  })
}

// The viewport centre of the first `word` inside `selector`.
async function wordPoint(page: Page, selector: string, word: string) {
  await page.bringToFront()
  const element = page.locator(selector).first()
  await element.scrollIntoViewIfNeeded()
  return element.evaluate((root, w) => {
    const nodes = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
      const offset = node.textContent?.indexOf(w) ?? -1
      if (offset < 0) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + w.length)
      const box = range.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    throw new Error(`${root.id || root.tagName} must contain the word ${w}`)
  }, word)
}

const popoverWord = (page: Page) =>
  page.locator('#enx-anchored-overlay [data-testid="word-popover-header"] h3')

async function expectClickOpens(page: Page, selector: string, word: string) {
  const point = await wordPoint(page, selector, word)
  await page.mouse.click(point.x, point.y)
  await expect(popoverWord(page)).toHaveText(word)
  await page.keyboard.press('Escape')
  await expect(page.locator('#enx-anchored-overlay')).toHaveCount(0)
}

async function expectClickIgnored(page: Page, selector: string, word: string) {
  const point = await wordPoint(page, selector, word)
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(500)
  await expect(page.locator('#enx-anchored-overlay')).toHaveCount(0)
}

async function expectDoubleClickOpens(
  page: Page,
  selector: string,
  word: string
) {
  const point = await wordPoint(page, selector, word)
  await page.mouse.dblclick(point.x, point.y)
  await expect(popoverWord(page)).toHaveText(word)
  await page.keyboard.press('Escape')
}

// Records the reading-progress deltas the content script reports (ADR-028).
async function recordReadingProgress(context: BrowserContext) {
  const [sw] = context.serviceWorkers()
  await sw.evaluate(() => {
    const deltas: unknown[] = []
    ;(self as unknown as Record<string, unknown>).__enxReadingDeltas = deltas
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === 'reportReadingProgress') deltas.push(message.delta)
      return false
    })
  })
}

async function readingDeltas(context: BrowserContext) {
  const [sw] = context.serviceWorkers()
  return sw.evaluate(
    () =>
      (self as unknown as Record<string, unknown>).__enxReadingDeltas as {
        wordsRead: number
        articlesRead: number
      }[]
  )
}

test.describe('Standard Ebooks body matter', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('a single-page novel: chapters are the article, front and back matter keep selection lookup', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await serveStandardEbooks(context)
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [['lantern', 3]],
    })
    await recordReadingProgress(context)
    await page.goto(`${BOOK}/text/single-page`, {
      waitUntil: 'domcontentloaded',
    })
    expect(
      await page.evaluate(() => document.contentType),
      'the fixture must be parsed as XHTML'
    ).toBe('application/xhtml+xml')
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    // `lantern` appears once in each chapter (the second nested in a
    // body-matter part) and once each in the front and back matter: only the
    // two chapter occurrences are painted, each once.
    const highlighted = await getHighlightedWords(page)
    expect(highlighted.map(word => word.text)).toEqual(['lantern', 'lantern'])
    expect(
      await page.evaluate(() => {
        const registry = (
          CSS as unknown as {
            highlights: Iterable<[string, Iterable<Range>]>
          }
        ).highlights
        const owners: string[] = []
        for (const [name, highlight] of registry) {
          if (!name.startsWith('enx-hl-')) continue
          for (const range of highlight) {
            owners.push(
              (range.startContainer.parentElement?.closest('section[id]')
                ?.id as string) ?? ''
            )
          }
        }
        return owners.sort()
      })
    ).toEqual(['chapter-1', 'chapter-2'])

    await expectClickOpens(page, '#chapter-1 p', 'swung')
    await expectClickOpens(page, '#chapter-2 p', 'midnight')
    await expectClickIgnored(page, '#imprint p', 'volunteers')
    await expectClickIgnored(page, '#colophon p', 'compiled')
    await expectDoubleClickOpens(page, '#titlepage p', 'cover')

    // Reading statistics run over the outermost body-matter roots and their
    // word count: clicking `midnight` marks everything before it in those
    // roots as read, and leaving the page reports that share of the words.
    const expectedWordsRead = await page.evaluate(() => {
      const roots = ['#chapter-1', '#part-2'].map(
        selector => document.querySelector(selector)!.textContent ?? ''
      )
      const totalWords = (
        roots
          .join(' ')
          .match(/\b[a-zA-Z][a-zA-Z'-]*[a-zA-Z]\b|\b[a-zA-Z]\b/g) ?? []
      ).length
      const totalChars = roots.join('').length
      const charsRead = roots[0].length + roots[1].indexOf('midnight')
      return Math.round((charsRead / totalChars) * totalWords)
    })
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await expect
      .poll(async () =>
        (await readingDeltas(context)).map(delta => delta.wordsRead)
      )
      .toEqual([expectedWordsRead])
  })

  test('a collection: stories and short poems are the article', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await serveStandardEbooks(context)
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [],
    })
    await page.goto(
      'https://standardebooks.org/ebooks/edgar-allan-poe/short-fiction/text/single-page',
      { waitUntil: 'domcontentloaded' }
    )
    await enableLearningMode(page, extensionId)

    await expectClickOpens(page, '#the-black-cat p', 'narrative')
    await expectClickOpens(page, '#alone p', 'childhood')
    await expectClickIgnored(page, '#imprint p', 'volunteers')
  })

  test('a per-chapter page: the body-matter main is the article, the site header is not', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await serveStandardEbooks(context)
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [],
    })
    await page.goto(`${BOOK}/text/chapter-1`, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)

    await expectClickOpens(page, '#chapter-1 p', 'swung')
    await expectClickIgnored(page, 'header p', 'formatted')
  })

  test('a front-matter page with no body matter enables as the whole page', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await serveStandardEbooks(context)
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [],
    })
    await page.goto(`${BOOK}/text/imprint`, { waitUntil: 'domcontentloaded' })
    // Throws unless enxRun succeeds.
    await enableLearningMode(page, extensionId)

    await expectClickIgnored(page, '#imprint p', 'volunteers')
    await expectDoubleClickOpens(page, '#imprint p', 'volunteers')
  })
})
