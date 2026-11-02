// ADR-069 Decision 2 (#567): underlines are registered only for the blocks
// within about one screen of the viewport, and follow the reader as they
// scroll. The fixture (test-fixtures/paint-window.html) builds its pages from
// a script, and the review list is stubbed, so every count below is computed
// from the page itself.

import type { BrowserContext, Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  clickHighlightedWord,
  enableLearningMode,
  getHighlightedWords,
  getHighlightedWordsCount,
  HIGHLIGHT_NAME_PREFIX,
  mockBackendFetch,
  setHighlightPref,
  waitForContentScript,
} from './helpers'

/** The fixture's review list words; each sentence holds every one twice. */
const REVIEW_WORDS = ['harbour', 'lantern', 'captain', 'chart', 'sailor']

type Shape = 'long' | 'nested' | 'br' | 'outer'

async function openShape(
  context: BrowserContext,
  page: Page,
  extensionId: string,
  shape: Shape
) {
  await mockBackendFetch(context, {
    reviewWords: REVIEW_WORDS.map((word): [string, number] => [word, 1]),
  })
  await page.goto(`/paint-window.html?shape=${shape}`, {
    waitUntil: 'domcontentloaded',
  })
  await enableLearningMode(page, extensionId)
  await waitForContentScript(page)
  // Headless Chromium stops rendering this page while the popup has focus,
  // and without rendering no observer reports scrolling.
  await page.bringToFront()
}

interface PaintState {
  /** Paragraphs in the checked area. */
  blocks: number
  /** Review list word occurrences in those paragraphs. */
  expected: number
  /** Registered ranges that start in those paragraphs. */
  painted: number
  /** Registered ranges anywhere whose text is not a review list word. */
  wrong: number
}

/**
 * Underlines in the article paragraphs on screen, or, with `belowScroller`,
 * in the nested scroll container's paragraphs that lie entirely within one
 * container height below its visible area.
 */
async function paintState(
  page: Page,
  { belowScroller = false } = {}
): Promise<PaintState> {
  return page.evaluate(
    ({ words, prefix, belowScroller }) => {
      const pattern = new RegExp(`\\b(${words.join('|')})\\b`, 'gi')
      const ranges: Range[] = []
      const registry = (
        CSS as unknown as { highlights: Iterable<[string, Iterable<Range>]> }
      ).highlights
      for (const [name, highlight] of registry) {
        if (name.startsWith(prefix)) ranges.push(...highlight)
      }
      const scroller = document.querySelector('.scroller')
      const area = belowScroller && scroller?.getBoundingClientRect()
      const inArea = (p: Element) => {
        const r = p.getBoundingClientRect()
        return area
          ? r.top >= area.bottom && r.bottom <= area.bottom + area.height
          : r.bottom > 0 && r.top < window.innerHeight
      }
      const blocks = [...document.querySelectorAll('article p')].filter(inArea)
      let expected = 0
      let painted = 0
      for (const p of blocks) {
        expected += (p.textContent?.match(pattern) ?? []).length
        painted += ranges.filter(r => p.contains(r.startContainer)).length
      }
      const wrong = ranges.filter(
        r => !words.includes(r.toString().toLowerCase())
      ).length
      return { blocks: blocks.length, expected, painted, wrong }
    },
    { words: REVIEW_WORDS, prefix: HIGHLIGHT_NAME_PREFIX, belowScroller }
  )
}

/** Underlines appear asynchronously, so poll until the area is fully painted. */
async function expectAreaPainted(page: Page, belowScroller = false) {
  await expect(async () => {
    const state = await paintState(page, { belowScroller })
    expect(state.blocks).toBeGreaterThan(0)
    expect(state.expected).toBeGreaterThan(0)
    expect(state.painted).toBe(state.expected)
    expect(state.wrong).toBe(0)
  }).toPass({ timeout: 5000 })
}

/**
 * The long page's limits: the occurrences in three viewports of text plus two
 * blocks, counting every paragraph as the largest block, and the page's total.
 */
async function fixtureLimits(page: Page) {
  return page.evaluate(words => {
    const pattern = new RegExp(`\\b(${words.join('|')})\\b`, 'gi')
    const paragraphs = [...document.querySelectorAll('article p')]
    const occurrences = paragraphs.map(
      p => (p.textContent?.match(pattern) ?? []).length
    )
    const shortest = Math.min(
      ...paragraphs.map(p => p.getBoundingClientRect().height)
    )
    const largest = Math.max(...occurrences)
    const blocksInThreeViewports = Math.ceil((3 * window.innerHeight) / shortest)
    return {
      bound: (blocksInThreeViewports + 2) * largest,
      total: occurrences.reduce((sum, n) => sum + n, 0),
    }
  }, REVIEW_WORDS)
}

async function scrollToParagraph(page: Page, index: number) {
  await page
    .locator('article p')
    .nth(index)
    .evaluate(p => p.scrollIntoView({ block: 'center' }))
}

test.describe('Paint window', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test.beforeEach(async ({ signedIn: _signedIn }) => {})

  test('scrolling down and back up keeps the underlines correct on screen', async ({
    context,
    page,
    extensionId,
  }) => {
    await openShape(context, page, extensionId, 'long')
    await expectAreaPainted(page)

    for (const index of [100, 250, 399, 250, 100, 0]) {
      await scrollToParagraph(page, index)
      await expectAreaPainted(page)
    }
  })

  test('jumping to an in-page anchor paints the destination', async ({
    context,
    page,
    extensionId,
  }) => {
    await openShape(context, page, extensionId, 'long')

    await page.locator('#jump-far').click()

    await expect(page.locator('#far')).toBeInViewport()
    await expectAreaPainted(page)
  })

  test('the registered range count stays bounded while scrolling the whole page', async ({
    context,
    page,
    extensionId,
  }) => {
    await openShape(context, page, extensionId, 'long')
    const { bound, total } = await fixtureLimits(page)

    const counts = await page.evaluate(async prefix => {
      const registry = (
        CSS as unknown as { highlights: Iterable<[string, { size: number }]> }
      ).highlights
      const rangeCount = () => {
        let n = 0
        for (const [name, highlight] of registry) {
          if (name.startsWith(prefix)) n += highlight.size
        }
        return n
      }
      const settle = async () => {
        await new Promise(resolve => requestAnimationFrame(resolve))
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const step = window.innerHeight / 2
      const end = document.documentElement.scrollHeight - window.innerHeight
      const samples: number[] = []
      for (let y = 0; y <= end + step; y += step) {
        window.scrollTo(0, y)
        await settle()
        samples.push(rangeCount())
      }
      for (let y = end; y >= 0; y -= step) {
        window.scrollTo(0, y)
        await settle()
        samples.push(rangeCount())
      }
      return samples
    }, HIGHLIGHT_NAME_PREFIX)

    const most = Math.max(...counts)
    console.log(
      `paint window bound: most ${most}, bound ${bound}, total ${total}, samples ${counts.length}`
    )
    expect(Math.min(...counts)).toBeGreaterThan(0)
    expect(most).toBeLessThanOrEqual(bound)
    expect(most).toBeLessThan(total / 2)
  })

  test('an article in a nested scroll container is underlined within one screen below the visible area', async ({
    context,
    page,
    extensionId,
  }) => {
    await openShape(context, page, extensionId, 'nested')

    await expectAreaPainted(page, true)
  })

  test('turning the highlight preference off and on clears and repaints the window', async ({
    context,
    page,
    extensionId,
  }) => {
    await openShape(context, page, extensionId, 'long')
    const { total } = await fixtureLimits(page)
    await scrollToParagraph(page, 200)
    await expectAreaPainted(page)

    await setHighlightPref(page, extensionId, false)
    await page.bringToFront()
    await expect.poll(() => getHighlightedWordsCount(page)).toBe(0)

    await setHighlightPref(page, extensionId, true)
    await page.bringToFront()
    await expectAreaPainted(page)
    expect(await getHighlightedWordsCount(page)).toBeLessThan(total / 2)
  })

  test('clicking a word far down the page opens the popover', async ({
    context,
    page,
    extensionId,
  }) => {
    await openShape(context, page, extensionId, 'long')
    await scrollToParagraph(page, 380)
    await expectAreaPainted(page)

    const viewport = page.viewportSize()!
    const words = await getHighlightedWords(page)
    const index = words.findIndex(
      w => w.y > 50 && w.y < viewport.height - 50
    )
    expect(index).toBeGreaterThanOrEqual(0)
    const text = await clickHighlightedWord(page, index)

    const popover = page.locator('#enx-anchored-overlay')
    await expect(
      popover.locator('[data-testid="word-popover-header"] h3')
    ).toHaveText(text)
  })

  // #599 starts from these numbers. Nothing is asserted: frame times depend on
  // the machine, and a headless run is not comparable to ADR-069's baseline.
  // `long` is the control.
  for (const shape of ['br', 'outer', 'long'] as const) {
    test(`measures scrolling the ${shape} page`, async ({
      context,
      page,
      extensionId,
    }) => {
      test.setTimeout(120_000)
      await openShape(context, page, extensionId, shape)

      const result = await page.evaluate(async prefix => {
        const registry = (
          CSS as unknown as {
            highlights: Iterable<[string, { size: number }]>
          }
        ).highlights
        const rangeCount = () => {
          let n = 0
          for (const [name, highlight] of registry) {
            if (name.startsWith(prefix)) n += highlight.size
          }
          return n
        }
        const frame = () =>
          new Promise<number>(resolve => requestAnimationFrame(resolve))
        const deltas: number[] = []
        let mostRanges = rangeCount()
        const end = document.documentElement.scrollHeight - window.innerHeight
        let last = await frame()
        while (window.scrollY < end && deltas.length < 1500) {
          window.scrollBy(0, 150)
          const now = await frame()
          deltas.push(now - last)
          last = now
          mostRanges = Math.max(mostRanges, rangeCount())
        }
        deltas.sort((a, b) => a - b)
        return {
          medianFrameMs: Number(deltas[deltas.length >> 1].toFixed(1)),
          frames: deltas.length,
          mostRanges,
        }
      }, HIGHLIGHT_NAME_PREFIX)

      console.log(`paint window measurement ${shape}: ${JSON.stringify(result)}`)
    })
  }
})
