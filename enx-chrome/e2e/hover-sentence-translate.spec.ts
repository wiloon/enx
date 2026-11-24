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

// #1125: the button hangs off the bottom-right corner of the hovered
// sentence's last character and never overlaps the sentence's own text.
const hoveredSentenceGeometry = (page: Page) =>
  page.evaluate(() => {
    const [sentence] = CSS.highlights.get('enx-hover-sentence')!
    const range = sentence as Range
    const rects = [...range.getClientRects()].filter(r => r.width && r.height)
    const root = range.commonAncestorContainer
    const texts: Node[] = []
    if (root instanceof Text) texts.push(root)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (range.intersectsNode(node)) texts.push(node)
    }
    let lastChar: DOMRect | null = null
    for (const node of texts) {
      const text = node as Text
      const start = node === range.startContainer ? range.startOffset : 0
      const end = node === range.endContainer ? range.endOffset : text.length
      for (let i = start; i < end; i++) {
        if (/\s/.test(text.data[i])) continue
        const probe = document.createRange()
        probe.setStart(text, i)
        probe.setEnd(text, i + 1)
        lastChar = [...probe.getClientRects()].at(-1) ?? lastChar
      }
    }
    return {
      lines: rects.map(rect => rect.toJSON()),
      lastChar: lastChar!.toJSON(),
    }
  })

type Box = { x: number; y: number; width: number; height: number }
type Line = { left: number; right: number; top: number; bottom: number }

const expectClearOfSentence = (box: Box, lines: Line[]) => {
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) {
    const overlaps =
      box.x < line.right &&
      box.x + box.width > line.left &&
      box.y < line.bottom &&
      box.y + box.height > line.top
    expect(overlaps).toBe(false)
  }
}

test.describe('Hover sentence translate button', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test.beforeEach(async ({ signedIn: _signedIn }) => {})

  test('shows the button below-right of the last character of a wrapped sentence and clears wash on leave', async ({
    page,
    extensionId,
  }) => {
    await page.goto('/hover-sentence.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page, { emptyReviewList: true })

    await hoverWord(page, 'early', '#wrap')
    const button = page.locator('.enx-hover-sentence-translate-button')
    await expect(button).toBeVisible({ timeout: 2000 })

    const wraps = await page.evaluate(() => {
      const range = document.createRange()
      range.selectNodeContents(document.querySelector('#wrap')!)
      return range.getClientRects().length >= 2
    })
    expect(wraps).toBe(true)

    const buttonBox = (await button.boundingBox())!
    const geometry = await hoveredSentenceGeometry(page)
    // Below and right of the last character of the last wrapped line.
    expect(buttonBox.x).toBeGreaterThanOrEqual(geometry.lastChar.right - 1)
    expect(buttonBox.x).toBeLessThanOrEqual(geometry.lastChar.right + 8)
    expect(buttonBox.y).toBeGreaterThanOrEqual(geometry.lastChar.bottom - 1)
    expect(buttonBox.y).toBeLessThanOrEqual(geometry.lastChar.bottom + 8)
    expectClearOfSentence(buttonBox, geometry.lines)

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

  for (const scenario of ['inline', 'narrow'] as const) {
    test(`puts the button below-right of the last character in a ${scenario} layout`, async ({
      page,
      extensionId,
    }) => {
      await page.setViewportSize({
        width: scenario === 'narrow' ? 280 : 1200,
        height: 740,
      })
      await page.goto('/hover-sentence.html', { waitUntil: 'domcontentloaded' })
      await page.evaluate(scenario => {
        document.body.classList.add(scenario)
        document.querySelector<HTMLElement>(`#${scenario}`)!.hidden = false
      }, scenario)
      await enableLearningMode(page, extensionId)
      await waitForContentScript(page, { emptyReviewList: true })
      await hoverWord(page, 'Early', `#${scenario}`)

      const button = page.locator('.enx-hover-sentence-translate-button')
      await expect(button).toBeVisible({ timeout: 2000 })
      const geometry = await hoveredSentenceGeometry(page)
      const box = (await button.boundingBox())!
      expectClearOfSentence(box, geometry.lines)
      expect(box.y).toBeGreaterThanOrEqual(geometry.lastChar.bottom - 1)
      if (scenario === 'inline') {
        // The next sentence continues on the same line: still below-right of
        // the last character, not lifted above it (#1125).
        const next = await page
          .locator('#continuation')
          .evaluate(el => el.getClientRects()[0].toJSON())
        expect(next.top).toBe(geometry.lastChar.top)
        expect(box.x).toBeGreaterThanOrEqual(geometry.lastChar.right - 1)
        expect(box.x).toBeLessThanOrEqual(geometry.lastChar.right + 8)
        expect(box.y).toBeLessThanOrEqual(geometry.lastChar.bottom + 8)
      } else {
        // Flush against the viewport's right edge: shifted in, still below.
        expect(geometry.lastChar.right).toBeGreaterThan(270)
        expect(box.x + box.width).toBeLessThanOrEqual(280)
      }
    })
  }

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
