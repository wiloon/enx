// Layer 6 (ADR-077): a page no selector recognises, which declares a
// NewsArticle in JSON-LD, gets Readability's node as the article. Readability
// is a chunk the content script loads on demand, so this runs in the built
// extension. The fixture is hand-written, not a real page.

import type { Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import { enableLearningMode, mockBackendFetch, wordLookupPosts } from './helpers'

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
    throw new Error(`The element must contain the word ${w}`)
  }, word)
}

test.describe('JSON-LD article with no selector match', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('a single click in the story opens the popover; a click outside it does not', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
    })
    await page.goto('/json-ld-article.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    const popover = page.locator('#enx-anchored-overlay')

    const outside = await wordPoint(page, '.site-footer', 'paper')
    await page.mouse.click(outside.x, outside.y)
    await page.waitForTimeout(500)
    await expect(popover).toHaveCount(0)

    const inside = await wordPoint(page, '#story', 'sailor')
    await page.mouse.click(inside.x, inside.y)
    await expect(
      popover.locator('[data-testid="word-popover-header"] h3')
    ).toHaveText('sailor')
    await expect.poll(() => wordLookupPosts(context)).toHaveLength(1)
  })
})
