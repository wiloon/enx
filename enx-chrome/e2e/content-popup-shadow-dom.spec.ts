// NOTE (ADR-011 issue #11 / #14): highlighting is painted with the CSS Custom
// Highlight API -- there are no `.enx-word` marker elements. A highlighted word
// is a Range in `CSS.highlights`; a lookup is a coordinate click on the word's
// on-screen box (clickHighlightedWord / getHighlightedWordRects in helpers.ts).

import { expect, test } from './fixtures'
import {
  clickHighlightedWord,
  enableLearningMode,
  getHighlightedWords,
  getHighlightedWordsCount,
  isWordHighlighted,
  mockBackendFetch,
  openPopup,
  seedLoggedInState,
  waitForContentScript,
} from './helpers'

// Covers TASK-SPEC-enx-chrome-word-popup-react.md §4.1 (viewport-edge
// anchoring, close paths), §4.2 (style isolation) and §4.4 (resource
// cleanup). Backend calls are stubbed (see mockBackendFetch in helpers.ts)
// so these tests don't depend on a real enx-api backend or a valid Cognito
// session -- see TASK-SPEC §4.4 discussion for why. mockBackendFetch reflects
// the actually-requested word back into the WordData it returns (see
// helpers.ts), so English always matches whatever word was clicked.

test.describe('Word popup - Shadow DOM React implementation', () => {
  test.beforeEach(async ({ context, page, extensionId }) => {
    // handleMarkAcquainted in background.ts short-circuits to sessionExpired
    // if no accessToken is present in storage, before it ever reaches the
    // mocked fetch -- seed a (fake, unvalidated) token so that client-side
    // gate passes. The mocked fetch is what actually answers the request.
    // chrome.storage is only reachable from an actual extension page (main
    // world of a plain http page never has `chrome.*` injected), so this has
    // to run against popup.html, same as the existing login() helper does.
    const popupPage = await page.context().newPage()
    await openPopup(popupPage, extensionId)
    await seedLoggedInState(popupPage, { username: 'test-user' })
    await popupPage.close()
    await mockBackendFetch(context, {
      wordData: {
        Pronunciation: '[stʌb]',
        Chinese: '存根',
        LoadCount: 3,
        AlreadyAcquainted: 0,
      },
    })
    await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)
  })

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
    const indexOfExtreme = (cmp: (a: number, b: number) => boolean, axis: 'x' | 'y') =>
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
      await page.waitForSelector('#enx-word-popup', { timeout: 3000 })

      const popupBox = await page.locator('#enx-word-popup').boundingBox()
      expect(popupBox, `${label}: popup should render with a bounding box`).toBeTruthy()
      if (!popupBox) continue

      console.log(`scenario(${label}) popupBox=`, popupBox, 'viewport=', viewport)
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
    const popup = page.locator('#enx-word-popup')
    await expect(popup).toBeVisible()

    const href = await popup.locator('a[title="Open in Youdao Dictionary"]').getAttribute('href')
    expect(href).toBe(
      `https://www.youdao.com/result?word=${encodeURIComponent(clickedWord)}&lang=en`
    )
  })

  test('§4.1: sessionExpired response still triggers the session-expired notification', async ({
    page,
    context,
  }) => {
    await mockBackendFetch(context, { translateSessionExpired: true })
    const popup = page.locator('#enx-word-popup')

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
    const popup = page.locator('#enx-word-popup')
    const clickedWord = await clickHighlightedWord(page, 0)
    await expect(popup).toBeVisible()

    await expect(popup.locator('[data-testid="word-popup-content"]')).toBeVisible()
    await expect(popup.locator('[data-testid="word-popup-header"] h3')).toHaveText(clickedWord)
    await expect(popup.locator('[data-testid="word-popup-content"]')).toContainText('存根')
  })

  test('§4.1: failure state renders via data-testid hook', async ({
    page,
    context,
  }) => {
    await mockBackendFetch(context, { translateFails: true })
    const popup = page.locator('#enx-word-popup')
    await clickHighlightedWord(page, 0)
    await expect(popup).toBeVisible()
    await expect(popup.locator('[data-testid="word-popup-error"]')).toBeVisible()
  })

  test('§4.1: close button / ESC / click-outside all close the popup', async ({
    page,
  }) => {
    const popup = page.locator('#enx-word-popup')

    await clickHighlightedWord(page, 0)
    await expect(popup).toBeVisible()
    await popup.locator('[data-testid="word-popup-close"]').click()
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

    const popup = page.locator('#enx-word-popup')
    const markBtn = popup.locator('[data-testid="word-popup-mark-known"]')
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
    const beforeDisplay = await probe.evaluate((el) => getComputedStyle(el).display)
    const beforeFontSize = await probe.evaluate((el) => getComputedStyle(el).fontSize)
    // sanity: fixture's own conflicting rules are actually in effect
    expect(beforeDisplay).toBe('block')
    expect(beforeFontSize).toBe('40px')

    await clickHighlightedWord(page, 0)
    const popup = page.locator('#enx-word-popup')
    await expect(popup).toBeVisible()

    const afterDisplay = await probe.evaluate((el) => getComputedStyle(el).display)
    const afterFontSize = await probe.evaluate((el) => getComputedStyle(el).fontSize)
    expect(afterDisplay, 'host page style unaffected by popup being open').toBe(beforeDisplay)
    expect(afterFontSize, 'host page style unaffected by popup being open').toBe(beforeFontSize)

    // reverse: the popup's own Tailwind classes must not be overridden by the
    // host page's conflicting .flex/.text-sm rules
    const headerDisplay = await popup
      .locator('[data-testid="word-popup-header"]')
      .evaluate((el) => getComputedStyle(el).display)
    expect(headerDisplay).toBe('flex')
  })

  test('§4.4: 50 open/close cycles leave no residue, bounded heap growth, and clean console', async ({
    page,
    context,
  }) => {
    const consoleIssues: string[] = []
    let unmountLogCount = 0
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleIssues.push(`${msg.type()}: ${msg.text()}`)
      }
      if (msg.text().includes('[enx] root unmounted')) {
        unmountLogCount++
      }
    })

    const count = await getHighlightedWordsCount(page)
    expect(count).toBeGreaterThan(0)

    const cdp = await context.newCDPSession(page)
    await cdp.send('HeapProfiler.enable')
    await cdp.send('HeapProfiler.collectGarbage')
    const heapBefore = await page.evaluate(
      () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0
    )

    const CYCLES = 50
    for (let i = 0; i < CYCLES; i++) {
      await clickHighlightedWord(page, i % count)
      await page.waitForSelector('#enx-word-popup', { timeout: 3000 })
      await page.evaluate(() => {
        const el = document.getElementById('enx-word-popup') as (HTMLElement & { hidePopover: () => void }) | null
        el?.hidePopover()
      })
      await page.waitForFunction(
        () => document.querySelectorAll('#enx-word-popup').length === 0
      )
    }

    expect(
      await page.evaluate(() => document.querySelectorAll('[popover]').length),
      'no residual popover elements after all cycles'
    ).toBe(0)

    await cdp.send('HeapProfiler.collectGarbage')
    const heapAfter = await page.evaluate(
      () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0
    )

    console.log('heap before:', heapBefore, 'after:', heapAfter, 'ratio:', heapBefore ? heapAfter / heapBefore : 'n/a')
    if (heapBefore > 0) {
      expect(heapAfter, 'heap growth stays within 1.5x baseline (starting threshold, calibrate as needed)').toBeLessThanOrEqual(
        heapBefore * 1.5
      )
    }

    expect(consoleIssues, consoleIssues.join('\n')).toHaveLength(0)
    expect(unmountLogCount).toBe(CYCLES)
  })
})
