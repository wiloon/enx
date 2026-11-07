// On a page whose paragraphs sit directly under <body> (a Gutenberg book, an
// RFC, a Paul Graham essay), no selector finds the article, so it is the
// whole page: selection lookup only, no click lookup (adr-034, 2026-11-07).
// The fixture is hand-written, not a real page.

import type { Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  enableLearningMode,
  mockBackendFetch,
  reviewWordsRequests,
  waitForContentScript,
  wordLookupPosts,
} from './helpers'

// The viewport centre of the first `word` under `body > p`.
async function wordPoint(page: Page, word: string) {
  await page.bringToFront()
  const paragraph = page.locator('body > p').first()
  await paragraph.scrollIntoViewIfNeeded()
  return paragraph.evaluate((element, w) => {
    const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
      const offset = node.textContent?.indexOf(w) ?? -1
      if (offset < 0) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + w.length)
      const box = range.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    throw new Error(`The paragraph must contain the word ${w}`)
  }, word)
}

test.describe('Paragraphs directly under body', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('a single click opens no popover; a double-click opens it and looks the word up once', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
    })
    await page.goto('/body-paragraphs.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    const popover = page.locator('#enx-anchored-overlay')

    const point = await wordPoint(page, 'sailor')
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(500)
    await expect(popover).toHaveCount(0)
    expect(await wordLookupPosts(context)).toHaveLength(0)

    await page.mouse.dblclick(point.x, point.y)
    await expect(
      popover.locator('[data-testid="word-popover-header"] h3')
    ).toHaveText('sailor')
    await expect.poll(() => wordLookupPosts(context)).toHaveLength(1)
    await page.waitForTimeout(500)
    expect(await wordLookupPosts(context)).toHaveLength(1)
  })

  // ADR-069: enabling sends one review-list GET with no page text; an empty
  // list is a successful enable, and a double-click still looks the word up.
  test('an empty review list enables, and a double-click still opens the popover', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [],
    })
    await page.goto('/body-paragraphs.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page, { emptyReviewList: true })

    expect(await reviewWordsRequests(context)).toEqual([
      {
        url: expect.stringMatching(/\/api\/me\/review-words$/),
        method: 'GET',
        body: null,
      },
    ])
    const point = await wordPoint(page, 'sailor')
    await page.mouse.dblclick(point.x, point.y)
    await expect(
      page.locator(
        '#enx-anchored-overlay [data-testid="word-popover-header"] h3'
      )
    ).toHaveText('sailor')
  })
})
