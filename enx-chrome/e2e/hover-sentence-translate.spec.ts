// Hover sentence-translate button (ADR-068 / #550): dwell, wrap-line anchor,
// wash, and grace across word/line gaps — needs a real browser for layout.

import type { Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import { enableLearningMode, waitForContentScript } from './helpers'

const wordPoint = async (
  page: Page,
  word: string,
  paragraphSelector: string
) => {
  const paragraph = page.locator(paragraphSelector)
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
    throw new Error(`missing word ${w}`)
  }, word)
}

const hoverWord = async (
  page: Page,
  word: string,
  paragraphSelector: string
) => {
  const point = await wordPoint(page, word, paragraphSelector)
  await page.mouse.move(point.x, point.y)
}

const gapBetweenWords = async (
  page: Page,
  left: string,
  right: string,
  paragraphSelector: string
) => {
  const a = await wordPoint(page, left, paragraphSelector)
  const b = await wordPoint(page, right, paragraphSelector)
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
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

    const geometry = await page.evaluate(() => {
      const p = document.querySelector('#wrap')!
      const range = document.createRange()
      range.selectNodeContents(p)
      const rects = [...range.getClientRects()]
      return {
        wraps: rects.length >= 2,
        last: (() => {
          const last = rects[rects.length - 1]
          return {
            top: last.top,
            bottom: last.bottom,
            left: last.left,
            right: last.right,
          }
        })(),
      }
    })
    expect(geometry.wraps).toBe(true)

    const buttonBox = await button.boundingBox()
    expect(buttonBox).not.toBeNull()
    // Anchored near the end of the last wrapped line on both axes.
    expect(buttonBox!.y).toBeGreaterThanOrEqual(geometry.last.top - 8)
    expect(buttonBox!.y).toBeLessThanOrEqual(geometry.last.bottom + 40)
    expect(buttonBox!.x).toBeGreaterThanOrEqual(geometry.last.left - 24)
    expect(Math.abs(buttonBox!.x - geometry.last.right)).toBeLessThan(80)

    expect(
      await page.evaluate(() => CSS.highlights.has('enx-hover-sentence'))
    ).toBe(true)

    // Occupy the measured gap long enough that a hide/remount would show.
    const gap = await gapBetweenWords(page, 'harbor', 'waited', '#wrap')
    await page.mouse.move(gap.x, gap.y)
    await page.waitForTimeout(750)
    await expect(button).toBeVisible()

    await hoverWord(page, 'waited', '#wrap')
    await expect(button).toBeVisible()

    // Leave the article entirely so grace expires (another sentence would
    // keep a button after its own dwell).
    await page.mouse.move(2, 2)
    await expect(button).toBeHidden({ timeout: 2000 })
    expect(
      await page.evaluate(() => CSS.highlights.has('enx-hover-sentence'))
    ).toBe(false)
  })

  test('uses the light host-page wash on a light article', async ({
    page,
    extensionId,
  }) => {
    await page.goto('/hover-sentence.html', { waitUntil: 'domcontentloaded' })
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
    expect(css).toContain('hsl(45 95% 55% / 20%)')
    expect(
      await page.evaluate(() => CSS.highlights.has('enx-hover-sentence'))
    ).toBe(true)

    await page.mouse.move(2, 2)
    await expect(
      page.locator('.enx-hover-sentence-translate-button')
    ).toBeHidden({ timeout: 2000 })
    expect(
      await page.evaluate(() => CSS.highlights.has('enx-hover-sentence'))
    ).toBe(false)
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
    expect(
      await page.evaluate(() => CSS.highlights.has('enx-hover-sentence'))
    ).toBe(true)

    await page.mouse.move(2, 2)
    await expect(
      page.locator('.enx-hover-sentence-translate-button')
    ).toBeHidden({ timeout: 2000 })
    expect(
      await page.evaluate(() => CSS.highlights.has('enx-hover-sentence'))
    ).toBe(false)
  })
})
