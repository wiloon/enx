// ADR-053: the Side Panel's sentence original carries the page's review-stage
// underlines, and a word looked up there is underlined on the page at once.
//
// Playwright can't drive Chrome's real side panel UI, so the panel runs as an
// ordinary extension tab at sidepanel.html?tabId=<page tab> -- the same URL
// openTabSidePanel() registers (ADR-050), reading the same per-tab keys.

import type { Page } from '@playwright/test'
import { FIXTURE_ORIGIN, loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  clickWordAndWaitForPopup,
  enableLearningMode,
  getHighlightedWords,
  waitForContentScript,
} from './helpers'

const TEST_PAGE_PATH = '/test-page.html'

// Text of every Range under each highlight name in `page`'s CSS.highlights.
async function highlightTexts(
  page: Page
): Promise<{ anchor: string[]; underlined: string[] }> {
  return await page.evaluate(() => {
    const registry = (
      CSS as unknown as { highlights: Iterable<[string, Iterable<Range>]> }
    ).highlights
    const anchor: string[] = []
    const underlined: string[] = []
    for (const [name, highlight] of registry) {
      for (const range of highlight) {
        if (name === 'enx-sp-anchor') anchor.push(range.toString())
        else if (name.startsWith('enx-hl-')) underlined.push(range.toString())
      }
    }
    return { anchor, underlined }
  })
}

// Selects `word` inside the panel's sentence original and fires the mouseup
// the panel resolves a lookup from (ADR-017).
async function selectWordInPanel(panel: Page, word: string) {
  await panel.evaluate(target => {
    const el = document.querySelector('[data-testid="sidepanel-sentence"]')!
    const node = el.firstChild as Text
    const start = node.data.indexOf(target)
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, start + target.length)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, word)
}

test.describe('Side Panel word underlines (ADR-053)', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  let panel: Page
  let anchorWord: string

  test.beforeEach(async ({ page, extensionId, signedIn: _signedIn }) => {
    await page.goto(TEST_PAGE_PATH, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    // Open the sentence of the first underlined word in the panel. The real
    // side panel may or may not open; the pending sentence is stored either way.
    anchorWord = (await getHighlightedWords(page))[0].text
    await clickWordAndWaitForPopup(page, 0)
    await page
      .locator(
        '#enx-anchored-overlay [data-testid="word-popover-sentence-translation"]'
      )
      .click()

    panel = await page.context().newPage()
    await panel.goto(`chrome-extension://${extensionId}/popup.html`)
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url }))[0].id!,
      `${FIXTURE_ORIGIN}${TEST_PAGE_PATH}`
    )
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`
    )
    await panel.getByTestId('sidepanel-sentence').waitFor()
  })

  test('the sentence original is underlined like the page, with the anchor marked', async ({
    page,
  }) => {
    const sentence = await panel.getByTestId('sidepanel-sentence').innerText()
    const pageUnderlined = new Set(
      (await getHighlightedWords(page)).map(w => w.text.toLowerCase())
    )
    const expected = sentence
      .split(/[^A-Za-z-]+/)
      .filter(w => pageUnderlined.has(w.toLowerCase()))

    await expect
      .poll(async () => (await highlightTexts(panel)).underlined.sort())
      .toEqual(expect.arrayContaining(expected.sort()))
    expect(
      (await highlightTexts(panel)).anchor.map(w => w.toLowerCase())
    ).toContain(anchorWord.toLowerCase())
  })

  test('a word looked up in the panel is underlined on the page', async ({
    page,
  }) => {
    const sentence = await panel.getByTestId('sidepanel-sentence').innerText()
    const pageUnderlined = new Set(
      (await getHighlightedWords(page)).map(w => w.text.toLowerCase())
    )
    // A word the page doesn't underline yet, so the assertion can't pass
    // vacuously. Every run looks one up, so the dev user can run out.
    const fresh = sentence
      .split(/[^A-Za-z]+/)
      .find(w => w.length > 3 && !pageUnderlined.has(w.toLowerCase()))
    test.skip(!fresh, 'every word in the sentence is already underlined')

    await selectWordInPanel(panel, fresh!)

    await expect
      .poll(async () =>
        (await getHighlightedWords(page)).map(w => w.text.toLowerCase())
      )
      .toContain(fresh!.toLowerCase())
    expect((await highlightTexts(panel)).underlined).toContain(fresh)
  })

  test('marking a word acquainted on the page drops its underline in the panel', async ({
    page,
  }) => {
    const anchorKey = anchorWord.toLowerCase()
    await expect
      .poll(async () =>
        (await highlightTexts(panel)).underlined.map(w => w.toLowerCase())
      )
      .toContain(anchorKey)

    // The anchor is still the page's first underlined word.
    await clickWordAndWaitForPopup(page, 0)
    await page
      .locator('#enx-anchored-overlay [data-testid="word-popover-mark-known"]')
      .click()

    await expect
      .poll(async () =>
        (await highlightTexts(panel)).underlined.map(w => w.toLowerCase())
      )
      .not.toContain(anchorKey)
  })
})
