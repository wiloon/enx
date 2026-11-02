// NOTE (ADR-011 issue #11 / #14): highlighting is painted with the CSS Custom
// Highlight API -- there are no `.enx-word` marker elements. A highlighted word
// is a Range in `CSS.highlights`; a lookup is a coordinate click on the word's
// on-screen box (clickHighlightedWord / getHighlightedWordRects in helpers.ts).

import type { Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  clickHighlightedWord,
  enableLearningMode,
  getHighlightedWords,
  getHighlightedWordsCount,
  isWordHighlighted,
  mockBackendFetch,
  waitForContentScript,
  wordLookupPosts,
} from './helpers'

/** Word top edge from getHighlightedWords centre + height. */
const wordTop = (w: { y: number; height: number }) => w.y - w.height / 2
const wordBottom = (w: { y: number; height: number }) => w.y + w.height / 2

/** Wheel until the word's box is fully above the viewport top. */
async function wheelWordAboveViewport(
  page: Page,
  wordIndex: number,
  pointer: { x: number; y: number }
) {
  await page.mouse.move(pointer.x, pointer.y)
  for (let i = 0; i < 50; i++) {
    const words = await getHighlightedWords(page)
    if (wordBottom(words[wordIndex]) < 0) return
    await page.mouse.wheel(0, 180)
  }
  throw new Error(`word ${wordIndex} never left the top of the viewport`)
}

/** Wheel until the word's box is fully below the viewport bottom. */
async function wheelWordBelowViewport(
  page: Page,
  wordIndex: number,
  pointer: { x: number; y: number }
) {
  const viewport = page.viewportSize()!
  await page.mouse.move(pointer.x, pointer.y)
  for (let i = 0; i < 50; i++) {
    const words = await getHighlightedWords(page)
    if (wordTop(words[wordIndex]) > viewport.height) return
    await page.mouse.wheel(0, -180)
  }
  throw new Error(`word ${wordIndex} never left the bottom of the viewport`)
}

/** Wheel until the word's box is fully inside the viewport again. */
async function wheelWordIntoViewport(
  page: Page,
  wordIndex: number,
  pointer: { x: number; y: number }
) {
  const viewport = page.viewportSize()!
  await page.mouse.move(pointer.x, pointer.y)
  for (let i = 0; i < 60; i++) {
    const words = await getHighlightedWords(page)
    const w = words[wordIndex]
    if (wordTop(w) >= 0 && wordBottom(w) <= viewport.height) return
    await page.mouse.wheel(0, wordTop(w) < 0 ? -180 : 180)
  }
  throw new Error(`word ${wordIndex} never returned to the viewport`)
}

async function tagOverlay(page: Page, selector: string, id: string) {
  await page.locator(selector).evaluate((el, tag) => {
    ;(el as HTMLElement).dataset.enxTestId = tag
  }, id)
}

async function overlayHitAtPointer(
  page: Page,
  pointer: { x: number; y: number },
  overlaySelector: string
): Promise<boolean> {
  return page.evaluate(
    ({ x, y, sel }) => {
      const el = document.elementFromPoint(x, y)
      if (!el) return false
      return Boolean(el.closest(sel) || (el.matches?.(sel) ?? false))
    },
    { x: pointer.x, y: pointer.y, sel: overlaySelector }
  )
}

/** Multi-line drag endpoints inside an article paragraph (0-based index). */
async function paragraphLineDragPoints(page: Page, paragraphIndex = 0) {
  return page.evaluate(index => {
    const p = document.querySelectorAll('article p')[index]
    if (!p) throw new Error(`no article paragraph at index ${index}`)
    const range = document.createRange()
    range.selectNodeContents(p)
    const rects = [...range.getClientRects()].filter(r => r.width > 0)
    if (rects.length < 2) {
      throw new Error(`need a multi-line paragraph, got ${rects.length} rects`)
    }
    const first = rects[0]
    const last = rects[rects.length - 1]
    return {
      firstStart: {
        x: first.left + Math.min(12, first.width / 4),
        y: first.top + first.height / 2,
      },
      lastEnd: {
        x: last.right - Math.min(12, last.width / 4),
        y: last.top + last.height / 2,
      },
    }
  }, paragraphIndex)
}

/** Extra scroll room so a word or selection can leave either viewport edge. */
async function addScrollSpacers(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById('enx-e2e-spacer-top')) return
    const top = document.createElement('div')
    top.id = 'enx-e2e-spacer-top'
    top.style.height = '900px'
    document.body.insertBefore(top, document.body.firstChild)
    const bottom = document.createElement('div')
    bottom.id = 'enx-e2e-spacer-bottom'
    bottom.style.height = '900px'
    document.body.appendChild(bottom)
  })
}

async function dragSelect(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

// Covers TASK-SPEC-enx-chrome-word-popup-react.md §4.1 (viewport-edge
// anchoring, close paths), §4.2 (style isolation) and §4.4 (resource
// cleanup). Backend calls are stubbed (see mockBackendFetch in helpers.ts)
// so these tests don't depend on enx-api's data -- see TASK-SPEC §4.4
// discussion for why. They still need a real Clerk session (ADR-037): the
// background mints a token before every request, ahead of the stubbed fetch.
// mockBackendFetch answers the review list with FIXTURE_REVIEW_WORDS and
// reflects the clicked word back into the WordData a lookup returns (see
// helpers.ts), so English always matches whatever word was clicked.

test.describe('Word popup - Shadow DOM React implementation', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test.beforeEach(
    async ({ context, page, extensionId, signedIn: _signedIn }) => {
      await mockBackendFetch(context, {
        wordData: {
          Pronunciation: '[stʌb]',
          Chinese: '存根',
          LoadCount: 3,
          Known: false,
        },
      })
      await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
      await enableLearningMode(page, extensionId)
      await waitForContentScript(page)
    }
  )

  test('§4.1: popup stays within viewport bounds when anchored near each edge', async ({
    page,
  }) => {
    const words = await getHighlightedWords(page)
    expect(words.length).toBeGreaterThan(0)

    // Pick the document-order index of the word nearest each viewport edge.
    // Indices are stable across the loop (nothing here mutates the highlight
    // set), and clickHighlightedWord only scrolls a word into view when it is
    // *off*-screen -- so these already-visible edge words keep their position
    // and the popup is genuinely anchored near the edge.
    const indexOfExtreme = (
      cmp: (a: number, b: number) => boolean,
      axis: 'x' | 'y'
    ) =>
      words.reduce(
        (best, w, i) => (cmp(w[axis], words[best][axis]) ? i : best),
        0
      )

    const viewport = page.viewportSize()!
    const scenarios: Array<{ label: string; index: number }> = [
      { label: 'top', index: indexOfExtreme((a, b) => a < b, 'y') },
      { label: 'bottom', index: indexOfExtreme((a, b) => a > b, 'y') },
      { label: 'left', index: indexOfExtreme((a, b) => a < b, 'x') },
      { label: 'right', index: indexOfExtreme((a, b) => a > b, 'x') },
    ]

    for (const { label, index } of scenarios) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)

      await clickHighlightedWord(page, index)
      await page.waitForSelector('#enx-anchored-overlay', { timeout: 3000 })

      const popupBox = await page.locator('#enx-anchored-overlay').boundingBox()
      expect(
        popupBox,
        `${label}: popup should render with a bounding box`
      ).toBeTruthy()
      if (!popupBox) continue

      console.log(
        `scenario(${label}) popupBox=`,
        popupBox,
        'viewport=',
        viewport
      )
      expect(popupBox.x, `${label}: left edge >= 0`).toBeGreaterThanOrEqual(0)
      expect(popupBox.y, `${label}: top edge >= 0`).toBeGreaterThanOrEqual(0)
      expect(
        popupBox.x + popupBox.width,
        `${label}: right edge <= viewport width`
      ).toBeLessThanOrEqual(viewport.width)
      expect(
        popupBox.y + popupBox.height,
        `${label}: bottom edge <= viewport height`
      ).toBeLessThanOrEqual(viewport.height)
    }
  })

  test('§4.1: Youdao link href matches the clicked word', async ({ page }) => {
    const clickedWord = await clickHighlightedWord(page, 0)
    const popup = page.locator('#enx-anchored-overlay')
    await expect(popup).toBeVisible()

    const href = await popup
      .locator('a[title="Open in Youdao Dictionary"]')
      .getAttribute('href')
    expect(href).toBe(
      `https://www.youdao.com/result?word=${encodeURIComponent(clickedWord)}&lang=en`
    )
  })

  test('§4.1: speaker plays the word on a popup opened from a selection', async ({
    page,
  }) => {
    // A double-click leaves the word selected. The speaker's mouseup used to
    // reach handleTextSelection with that selection still live, so it re-ran
    // the lookup and swapped the overlay before the click landed: the query
    // count went up and nothing played.
    const audioRequests: string[] = []
    await page.route('**/dict.youdao.com/dictvoice*', route => {
      audioRequests.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' })
    })

    const [word] = await getHighlightedWords(page)
    await page.mouse.dblclick(word.x, word.y)
    const popup = page.locator('#enx-anchored-overlay')
    const play = popup.locator(
      '[data-testid="word-popover-play-pronunciation"]'
    )
    await expect(play).toBeVisible()
    await popup.evaluate(el => el.setAttribute('data-e2e-marker', 'first'))

    await play.click()

    await expect.poll(() => audioRequests.length).toBeGreaterThan(0)
    expect(audioRequests[0]).toContain(`audio=${encodeURIComponent(word.text)}`)
    // Still the overlay the double-click opened, not a fresh lookup's.
    await expect(popup).toHaveAttribute('data-e2e-marker', 'first')
  })

  test('§4.1: sessionExpired response still triggers the session-expired notification', async ({
    page,
    context,
  }) => {
    await mockBackendFetch(context, { translateSessionExpired: true })
    const popup = page.locator('#enx-anchored-overlay')

    await clickHighlightedWord(page, 0)
    // The popup opens showing loading state, then immediately closes once
    // the mocked 401/sessionExpired response comes back -- so it may already
    // be gone by the time we get to check it; only the end state matters here.
    await expect(popup).toHaveCount(0)
    await expect(page.locator('#enx-session-expired')).toBeVisible()
  })

  test('§4.1: loading -> success content renders via data-testid hooks', async ({
    page,
  }) => {
    const popup = page.locator('#enx-anchored-overlay')
    const clickedWord = await clickHighlightedWord(page, 0)
    await expect(popup).toBeVisible()

    await expect(
      popup.locator('[data-testid="word-popover-content"]')
    ).toBeVisible()
    await expect(
      popup.locator('[data-testid="word-popover-header"] h3')
    ).toHaveText(clickedWord)
    await expect(
      popup.locator('[data-testid="word-popover-content"]')
    ).toContainText('存根')
  })

  test('§4.1: failure state renders via data-testid hook', async ({
    page,
    context,
  }) => {
    await mockBackendFetch(context, { translateFails: true })
    const popup = page.locator('#enx-anchored-overlay')
    await clickHighlightedWord(page, 0)
    await expect(popup).toBeVisible()
    await expect(
      popup.locator('[data-testid="word-popover-error"]')
    ).toBeVisible()
  })

  test('§4.1: close button / ESC / click-outside all close the popup', async ({
    page,
  }) => {
    const popup = page.locator('#enx-anchored-overlay')

    await clickHighlightedWord(page, 0)
    await expect(popup).toBeVisible()
    await popup.locator('[data-testid="word-popover-close"]').click()
    await expect(popup).toHaveCount(0)

    await clickHighlightedWord(page, 0)
    await expect(popup).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)

    await clickHighlightedWord(page, 0)
    await expect(popup).toBeVisible()
    await page.waitForTimeout(150) // click-outside listener attaches async, see helpers
    await page.locator('h1').click()
    await expect(popup).toHaveCount(0)
  })

  test('§4.1: Mark Known closes the popup and drops the word from every highlight bucket', async ({
    page,
  }) => {
    const countBefore = await getHighlightedWordsCount(page)
    const word = await clickHighlightedWord(page, 0)
    expect(await isWordHighlighted(page, word)).toBe(true)

    const popup = page.locator('#enx-anchored-overlay')
    const markBtn = popup.locator('[data-testid="word-popover-mark-known"]')
    await expect(markBtn).toBeVisible()
    await markBtn.click()
    await expect(popup).toHaveCount(0)

    await page.waitForTimeout(200)

    // ADR-011: a no-longer-reviewable word drops out of every highlight
    // bucket -- its Range disappears from CSS.highlights rather than the old
    // behaviour of the marker element's underline turning white.
    expect(await isWordHighlighted(page, word)).toBe(false)
    expect(await getHighlightedWordsCount(page)).toBeLessThan(countBefore)
  })

  test('§4.2: popup Tailwind styles are isolated from a host page with conflicting class names', async ({
    page,
  }) => {
    const probe = page.locator('#host-conflict-probe')
    const beforeDisplay = await probe.evaluate(
      el => getComputedStyle(el).display
    )
    const beforeFontSize = await probe.evaluate(
      el => getComputedStyle(el).fontSize
    )
    // sanity: fixture's own conflicting rules are actually in effect
    expect(beforeDisplay).toBe('block')
    expect(beforeFontSize).toBe('40px')

    await clickHighlightedWord(page, 0)
    const popup = page.locator('#enx-anchored-overlay')
    await expect(popup).toBeVisible()

    const afterDisplay = await probe.evaluate(
      el => getComputedStyle(el).display
    )
    const afterFontSize = await probe.evaluate(
      el => getComputedStyle(el).fontSize
    )
    expect(afterDisplay, 'host page style unaffected by popup being open').toBe(
      beforeDisplay
    )
    expect(
      afterFontSize,
      'host page style unaffected by popup being open'
    ).toBe(beforeFontSize)

    // reverse: the popup's own Tailwind classes must not be overridden by the
    // host page's conflicting .flex/.text-sm rules
    const headerDisplay = await popup
      .locator('[data-testid="word-popover-header"]')
      .evaluate(el => getComputedStyle(el).display)
    expect(headerDisplay).toBe('flex')
  })

  test('§4.4: 50 open/close cycles leave no residue, bounded heap growth, and clean console', async ({
    page,
    context,
  }) => {
    const consoleIssues: string[] = []
    let unmountLogCount = 0
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleIssues.push(`${msg.type()}: ${msg.text()}`)
      }
      if (msg.text().includes('[enx] root unmounted')) {
        unmountLogCount++
      }
    })

    const count = await getHighlightedWordsCount(page)
    expect(count).toBeGreaterThan(0)

    // locator.waitFor(), not waitForSelector(): the latter returns an
    // ElementHandle that pins every closed overlay (and React's ~140 root
    // listeners on it) in the heap, which read as a leak here.
    const openAndClose = async (i: number) => {
      await clickHighlightedWord(page, i % count)
      await page.locator('#enx-anchored-overlay').waitFor({ timeout: 3000 })
      await page.evaluate(() => {
        const el = document.getElementById('enx-anchored-overlay') as
          (HTMLElement & { hidePopover: () => void }) | null
        el?.hidePopover()
      })
      // Poll independently of animation frames: on ser8 a background page
      // throttles rAF to ~1 Hz (1,016 ms/cycle); 50 ms polling takes ~63 ms/cycle.
      await page.waitForFunction(
        () => document.querySelectorAll('#enx-anchored-overlay').length === 0,
        undefined,
        { polling: 50 }
      )
    }

    // Warm up before the baseline: the first opens load the popup chunk and
    // initialise React (~1.7 MB, once), which is not growth per cycle.
    const WARMUP = 5
    for (let i = 0; i < WARMUP; i++) await openAndClose(i)

    const cdp = await context.newCDPSession(page)
    await cdp.send('HeapProfiler.enable')
    await cdp.send('HeapProfiler.collectGarbage')
    const heapBefore = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0
    )

    const CYCLES = 50
    for (let i = WARMUP; i < WARMUP + CYCLES; i++) await openAndClose(i)

    // The toolbar pin hint (ADR-046) is meant to stay up in a fresh profile;
    // only overlays opened by a lookup count as residue.
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll('[popover]:not(.enx-pin-hint)')].map(
          el => el.id || el.className || el.tagName
        )
      ),
      'no residual popover elements after all cycles'
    ).toEqual([])

    await cdp.send('HeapProfiler.collectGarbage')
    const heapAfter = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0
    )

    console.log(
      'heap before:',
      heapBefore,
      'after:',
      heapAfter,
      'ratio:',
      heapBefore ? heapAfter / heapBefore : 'n/a'
    )
    if (heapBefore > 0) {
      expect(
        heapAfter,
        'heap growth over 50 cycles stays within 1.5x the warmed-up baseline'
      ).toBeLessThanOrEqual(heapBefore * 1.5)
    }

    expect(consoleIssues, consoleIssues.join('\n')).toHaveLength(0)
    expect(unmountLogCount).toBe(WARMUP + CYCLES)
  })
})

// ADR-059 Decision 3: the lookup GET only reads the query count; the click
// adds one with a single POST, and the popover shows the new count without
// waiting for it.
test.describe('Word popup - query count', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('a click shows one more lookup at once and records it with one POST', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
    })
    await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const popup = page.locator('#enx-anchored-overlay')
    await clickHighlightedWord(page, 0)
    await expect(popup.getByText('Looked up 4 times')).toBeAttached()

    await expect
      .poll(() => wordLookupPosts(context))
      .toEqual([{ wordId: 'w-stub' }])
  })
})

// #523: when the anchor scrolls out of the viewport, hide the overlay in
// place (visibility:hidden) instead of letting flip/shift park it near the
// pointer. Both the word card and the drag-select hint share the rule.
test.describe('Anchored overlays hide when the reference scrolls off-screen (#523)', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  test.describe.configure({ timeout: 90_000 })

  test.beforeEach(
    async ({ context, page, extensionId, signedIn: _signedIn }) => {
      await mockBackendFetch(context, {
        wordData: {
          Pronunciation: '[stʌb]',
          Chinese: '存根',
          LoadCount: 3,
          Known: false,
        },
      })
      await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
      await addScrollSpacers(page)
      await enableLearningMode(page, extensionId)
      await waitForContentScript(page)
    }
  )

  test('word card: scrolling the word above the top hides it; scrolling back restores it', async ({
    page,
  }) => {
    await page.locator('article').scrollIntoViewIfNeeded()
    const viewport = page.viewportSize()!
    const words = await getHighlightedWords(page)
    let index = -1
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (wordTop(w) >= 0 && wordBottom(w) <= viewport.height) {
        if (index < 0 || w.y < words[index].y) index = i
      }
    }
    expect(index).toBeGreaterThanOrEqual(0)
    const pointer = {
      x: words[index].x,
      y: Math.min(words[index].y + 40, 400),
    }

    await clickHighlightedWord(page, index)
    const popup = page.locator('#enx-anchored-overlay')
    await expect(
      popup.locator('[data-testid="word-popover-content"]')
    ).toBeVisible()
    const wordText = await popup
      .locator('[data-testid="word-popover-header"] h3')
      .innerText()
    await tagOverlay(page, '#enx-anchored-overlay', 'word-card-top')

    await wheelWordAboveViewport(page, index, pointer)

    await expect(popup).toBeHidden()
    await expect(popup).toHaveCount(1)
    await expect(popup).toHaveAttribute('data-enx-test-id', 'word-card-top')
    expect(await overlayHitAtPointer(page, pointer, '#enx-anchored-overlay')).toBe(
      false
    )
    expect(
      await page.evaluate(
        () => document.querySelectorAll('#enx-anchored-overlay').length
      )
    ).toBe(1)

    await wheelWordIntoViewport(page, index, pointer)

    await expect(popup).toBeVisible()
    await expect(popup).toHaveAttribute('data-enx-test-id', 'word-card-top')
    await expect(
      popup.locator('[data-testid="word-popover-header"] h3')
    ).toHaveText(wordText)
    await expect(
      popup.locator('[data-testid="word-popover-content"]')
    ).toContainText('存根')

    const restored = await getHighlightedWords(page)
    const word = restored[index]
    const box = await popup.boundingBox()
    expect(box).toBeTruthy()
    const wordTopEdge = wordTop(word)
    const wordBottomEdge = wordBottom(word)
    const nearVertically =
      Math.abs(box!.y + box!.height - wordTopEdge) < 48 ||
      Math.abs(box!.y - wordBottomEdge) < 48
    expect(nearVertically, 'popup sits next to the word again').toBe(true)
  })

  test('word card: scrolling the word below the bottom hides it; scrolling back restores it', async ({
    page,
  }) => {
    await page.locator('article').scrollIntoViewIfNeeded()
    // Park a mid-article word near the bottom of the viewport.
    await page.evaluate(() => {
      const article = document.querySelector('article')
      if (!article) return
      const rect = article.getBoundingClientRect()
      window.scrollBy(0, rect.bottom - window.innerHeight + 80)
    })
    await page.waitForTimeout(100)

    const viewport = page.viewportSize()!
    const words = await getHighlightedWords(page)
    let index = -1
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (wordTop(w) >= 0 && wordBottom(w) <= viewport.height) {
        if (index < 0 || w.y > words[index].y) index = i
      }
    }
    expect(index).toBeGreaterThanOrEqual(0)
    const pointer = {
      x: words[index].x,
      y: Math.max(40, words[index].y - 40),
    }

    await clickHighlightedWord(page, index)
    const popup = page.locator('#enx-anchored-overlay')
    await expect(
      popup.locator('[data-testid="word-popover-content"]')
    ).toBeVisible()
    await tagOverlay(page, '#enx-anchored-overlay', 'word-card-bottom')

    await wheelWordBelowViewport(page, index, pointer)

    await expect(popup).toBeHidden()
    await expect(popup).toHaveAttribute('data-enx-test-id', 'word-card-bottom')
    expect(await overlayHitAtPointer(page, pointer, '#enx-anchored-overlay')).toBe(
      false
    )

    await wheelWordIntoViewport(page, index, pointer)
    await expect(popup).toBeVisible()
    await expect(popup).toHaveAttribute('data-enx-test-id', 'word-card-bottom')
  })

  test('word card: a lookup that finishes while hidden still shows success on the same overlay', async ({
    page,
    context,
    extensionId,
  }) => {
    await mockBackendFetch(context, {
      wordData: {
        Id: 'w-hide-state',
        Pronunciation: '[stʌb]',
        Chinese: '存根',
        LoadCount: 3,
        Known: false,
      },
      lookupDelayMs: 1200,
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await addScrollSpacers(page)
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)
    await page.locator('article').scrollIntoViewIfNeeded()

    const viewport = page.viewportSize()!
    const words = await getHighlightedWords(page)
    let index = -1
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (wordTop(w) >= 0 && wordBottom(w) <= viewport.height) {
        if (index < 0 || w.y < words[index].y) index = i
      }
    }
    expect(index).toBeGreaterThanOrEqual(0)
    const pointer = {
      x: words[index].x,
      y: Math.min(words[index].y + 40, 400),
    }

    await clickHighlightedWord(page, index)
    const popup = page.locator('#enx-anchored-overlay')
    await expect(
      popup.locator('[data-testid="word-popover-loading"]')
    ).toBeVisible()
    await tagOverlay(page, '#enx-anchored-overlay', 'word-card-loading')

    await wheelWordAboveViewport(page, index, pointer)
    await expect(popup).toBeHidden()

    await page.waitForTimeout(1400)
    await wheelWordIntoViewport(page, index, pointer)

    await expect(popup).toBeVisible()
    await expect(popup).toHaveAttribute('data-enx-test-id', 'word-card-loading')
    await expect(
      popup.locator('[data-testid="word-popover-content"]')
    ).toContainText('存根')
    await expect
      .poll(() => wordLookupPosts(context))
      .toEqual([{ wordId: 'w-hide-state' }])
  })

  test('word card: Escape while hidden closes it for good', async ({ page }) => {
    await page.locator('article').scrollIntoViewIfNeeded()
    const viewport = page.viewportSize()!
    const words = await getHighlightedWords(page)
    let index = -1
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (wordTop(w) >= 0 && wordBottom(w) <= viewport.height) {
        if (index < 0 || w.y < words[index].y) index = i
      }
    }
    expect(index).toBeGreaterThanOrEqual(0)
    const pointer = {
      x: words[index].x,
      y: Math.min(words[index].y + 40, 400),
    }

    await clickHighlightedWord(page, index)
    const popup = page.locator('#enx-anchored-overlay')
    await expect(
      popup.locator('[data-testid="word-popover-content"]')
    ).toBeVisible()

    await wheelWordAboveViewport(page, index, pointer)
    await expect(popup).toBeHidden()

    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)

    await wheelWordIntoViewport(page, index, pointer)
    await expect(popup).toHaveCount(0)
  })

  test('word card: click-outside while hidden closes it for good', async ({
    page,
  }) => {
    await page.locator('article').scrollIntoViewIfNeeded()
    const viewport = page.viewportSize()!
    const words = await getHighlightedWords(page)
    let index = -1
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (wordTop(w) >= 0 && wordBottom(w) <= viewport.height) {
        if (index < 0 || w.y < words[index].y) index = i
      }
    }
    expect(index).toBeGreaterThanOrEqual(0)
    const pointer = {
      x: words[index].x,
      y: Math.min(words[index].y + 40, 400),
    }

    await clickHighlightedWord(page, index)
    const popup = page.locator('#enx-anchored-overlay')
    await expect(
      popup.locator('[data-testid="word-popover-content"]')
    ).toBeVisible()
    await page.waitForTimeout(150)

    await wheelWordAboveViewport(page, index, pointer)
    await expect(popup).toBeHidden()

    await page.locator('h1').click({ force: true })
    await expect(popup).toHaveCount(0)

    await wheelWordIntoViewport(page, index, pointer)
    await expect(popup).toHaveCount(0)
  })

  test('selection button: forward drag hides when the last line leaves the top', async ({
    page,
    extensionId,
  }) => {
    await page.locator('article').scrollIntoViewIfNeeded()
    const points = await paragraphLineDragPoints(page, 0)
    await dragSelect(page, points.firstStart, points.lastEnd)

    const button = page.locator('.enx-selection-translate-button')
    await expect(button).toBeVisible()
    await tagOverlay(page, '.enx-selection-translate-button', 'sel-forward')

    const anchor = await button.boundingBox()
    expect(anchor).toBeTruthy()
    const pointer = {
      x: points.lastEnd.x,
      y: Math.min((anchor?.y ?? points.lastEnd.y) + 40, 500),
    }

    await page.mouse.move(pointer.x, pointer.y)
    for (let i = 0; i < 30; i++) {
      const stillInView = await page.evaluate(() => {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return true
        const rects = sel.getRangeAt(0).getClientRects()
        if (rects.length === 0) return true
        return rects[rects.length - 1].bottom >= 0
      })
      if (!stillInView) break
      await page.mouse.wheel(0, 400)
      if (i === 29) throw new Error('last line never left the top')
    }

    await expect(button).toBeHidden()
    await expect(button).toHaveCount(1)
    await expect(button).toHaveAttribute('data-enx-test-id', 'sel-forward')
    expect(
      await overlayHitAtPointer(page, pointer, '.enx-selection-translate-button')
    ).toBe(false)

    await page.mouse.move(pointer.x, pointer.y)
    for (let i = 0; i < 30; i++) {
      const visible = await button.isVisible().catch(() => false)
      if (visible) break
      await page.mouse.wheel(0, -400)
      if (i === 29) throw new Error('selection button never returned')
    }

    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('data-enx-test-id', 'sel-forward')

    const lastRect = await page.evaluate(() => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      const rects = sel.getRangeAt(0).getClientRects()
      if (rects.length === 0) return null
      const last = rects[rects.length - 1]
      return { top: last.top, bottom: last.bottom }
    })
    expect(lastRect).toBeTruthy()
    const box = await button.boundingBox()
    expect(box).toBeTruthy()
    const near =
      Math.abs(box!.y - lastRect!.bottom) < 40 ||
      Math.abs(box!.y + box!.height - lastRect!.top) < 40
    expect(near, 'button sits beside the last line').toBe(true)

    // Click still runs the translate path: the button tears itself down and
    // openSentencePanel writes a pending sentence for this tab.
    await button.click()
    await expect(button).toHaveCount(0)
    const extPage = await page.context().newPage()
    await extPage.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect
      .poll(async () =>
        extPage.evaluate(async () => {
          const all = await chrome.storage.session.get(null)
          return Object.keys(all).some(k => k.startsWith('enx-pending-sentence:'))
        })
      )
      .toBe(true)
    await extPage.close()
  })

  test('selection button: backward drag hides when the first line leaves the bottom', async ({
    page,
  }) => {
    // Last paragraph, parked near the bottom of the viewport so wheeling up
    // can push its first line off the bottom edge.
    await page.locator('article p').last().scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      const p = document.querySelector('article p:last-of-type')
      if (!p) return
      const rect = p.getBoundingClientRect()
      window.scrollBy(0, rect.bottom - window.innerHeight + 40)
    })
    await page.waitForTimeout(100)

    const points = await paragraphLineDragPoints(page, 4)
    await dragSelect(page, points.lastEnd, points.firstStart)

    const button = page.locator('.enx-selection-translate-button')
    await expect(button).toBeVisible()
    await tagOverlay(page, '.enx-selection-translate-button', 'sel-backward')

    const viewport = page.viewportSize()!
    const pointer = {
      x: points.firstStart.x,
      y: Math.max(40, points.firstStart.y - 40),
    }

    await page.mouse.move(pointer.x, pointer.y)
    for (let i = 0; i < 30; i++) {
      const stillInView = await page.evaluate(vh => {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return true
        const rects = sel.getRangeAt(0).getClientRects()
        if (rects.length === 0) return true
        return rects[0].top <= vh
      }, viewport.height)
      if (!stillInView) break
      await page.mouse.wheel(0, -400)
      if (i === 29) throw new Error('first line never left the bottom')
    }

    await expect(button).toBeHidden()
    await expect(button).toHaveAttribute('data-enx-test-id', 'sel-backward')
    expect(
      await overlayHitAtPointer(page, pointer, '.enx-selection-translate-button')
    ).toBe(false)

    await page.mouse.move(pointer.x, pointer.y)
    for (let i = 0; i < 30; i++) {
      const visible = await button.isVisible().catch(() => false)
      if (visible) break
      await page.mouse.wheel(0, 400)
      if (i === 29) throw new Error('selection button never returned')
    }

    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('data-enx-test-id', 'sel-backward')
  })

  test('selection button: Escape while hidden removes it for good', async ({
    page,
  }) => {
    await page.locator('article').scrollIntoViewIfNeeded()
    const points = await paragraphLineDragPoints(page, 0)
    await dragSelect(page, points.firstStart, points.lastEnd)

    const button = page.locator('.enx-selection-translate-button')
    await expect(button).toBeVisible()

    const pointer = {
      x: points.lastEnd.x,
      y: Math.min(points.lastEnd.y + 40, 500),
    }
    await page.mouse.move(pointer.x, pointer.y)
    for (let i = 0; i < 30; i++) {
      const stillInView = await page.evaluate(() => {
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0) return true
        const rects = sel.getRangeAt(0).getClientRects()
        if (rects.length === 0) return true
        return rects[rects.length - 1].bottom >= 0
      })
      if (!stillInView) break
      await page.mouse.wheel(0, 400)
      if (i === 29) throw new Error('last line never left the top')
    }
    await expect(button).toBeHidden()

    await page.keyboard.press('Escape')
    await expect(button).toHaveCount(0)

    await page.mouse.move(pointer.x, pointer.y)
    await page.mouse.wheel(0, -800)
    await page.mouse.wheel(0, -800)
    await expect(button).toHaveCount(0)
  })
})
