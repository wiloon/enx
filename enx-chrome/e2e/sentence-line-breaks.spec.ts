// Sentence segmentation under a newline-preserving white-space (#1137): a real
// browser, because the paragraph only inherits white-space from the article.

import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import { enableLearningMode, waitForContentScript } from './helpers'

test.describe('Sentence line breaks', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test.beforeEach(async ({ signedIn: _signedIn }) => {})

  test('hovering a dash-list line takes that line only as the sentence', async ({
    page,
    extensionId,
  }) => {
    await page.goto('/sentence-line-breaks.html', {
      waitUntil: 'domcontentloaded',
    })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page, { emptyReviewList: true })

    // The first "spread" of the third list line.
    const point = await page.locator('article p').evaluate(paragraph => {
      const nodes = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
        const offset = node.textContent!.indexOf('spread')
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 'spread'.length)
        const box = range.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      }
      throw new Error('missing word spread')
    })
    await page.mouse.move(point.x, point.y)

    await expect(
      page.locator('.enx-hover-sentence-translate-button')
    ).toBeVisible({ timeout: 2000 })
    expect(
      await page.evaluate(() => {
        const [sentence] = CSS.highlights.get('enx-hover-sentence')!
        return (sentence as Range).toString()
      })
    ).toBe('- A spread turn moves it to the first line of the new spread.')
  })
})
