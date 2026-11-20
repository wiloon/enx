// Hover sentence-translate button (ADR-068 / #550): dwell, wrap-line anchor,
// wash, and grace across word/line gaps — needs a real browser for layout.

import type { Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import { enableLearningMode, waitForContentScript } from './helpers'

const hoverWord = async (
  page: Page,
  word: string,
  paragraphSelector: string
) => {
  const paragraph = page.locator(paragraphSelector)
  await paragraph.scrollIntoViewIfNeeded()
  const point = await paragraph.evaluate((element, w) => {
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
    throw new Error(`missing word ${w}`)
  }, word)
  await page.mouse.move(point.x, point.y)
}

test.describe('Hover sentence translate button', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test.beforeEach(async ({ signedIn: _signedIn }) => {})

  test('shows the button at the last line of a wrapped sentence and clears wash on leave', async ({
    page,
    extensionId,
  }) => {
    await page.goto('/hover-sentence.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page, { emptyReviewList: true })

    await hoverWord(page, 'early', '#wrap')
    const button = page.locator('.enx-hover-sentence-translate-button')
    await expect(button).toBeVisible({ timeout: 2000 })

    const lastLineBox = await page.evaluate(() => {
      const p = document.querySelector('#wrap')!
      const range = document.createRange()
      range.selectNodeContents(p)
      const rects = [...range.getClientRects()]
      const last = rects[rects.length - 1]
      return { top: last.top, bottom: last.bottom, right: last.right }
    })
    expect(lastLineBox.bottom - lastLineBox.top).toBeGreaterThan(0)

    const buttonBox = await button.boundingBox()
    expect(buttonBox).not.toBeNull()
    // Anchored to the last wrapped line, not the first.
    expect(buttonBox!.y).toBeGreaterThanOrEqual(lastLineBox.top - 8)

    const washPresent = await page.evaluate(() =>
      CSS.highlights.has('enx-hover-sentence')
    )
    expect(washPresent).toBe(true)

    // Move through word and wrap gaps inside the sentence; button stays.
    await hoverWord(page, 'harbor', '#wrap')
    await expect(button).toBeVisible()
    await hoverWord(page, 'waited', '#wrap')
    await expect(button).toBeVisible()

    // Leave the article entirely so grace expires (another sentence would
    // keep a button after its own dwell).
    await page.mouse.move(2, 2)
    await expect(button).toBeHidden({ timeout: 2000 })
    const washGone = await page.evaluate(() =>
      CSS.highlights.has('enx-hover-sentence')
    )
    expect(washGone).toBe(false)
  })

  test('uses the dark host-page wash on a dark article', async ({
    page,
    extensionId,
  }) => {
    await page.goto('/hover-sentence.html', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.body.classList.add('dark'))
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page, { emptyReviewList: true })

    await hoverWord(page, 'early', '#wrap')
    await expect(
      page.locator('.enx-hover-sentence-translate-button')
    ).toBeVisible({ timeout: 2000 })

    const css = await page.evaluate(() => {
      return (
        document.head.querySelector('style[data-enx-highlight-styles]')
          ?.textContent ?? ''
      )
    })
    expect(css).toContain('::highlight(enx-hover-sentence)')
    expect(css).toContain('hsl(45 95% 45% / 12%)')
  })
})
