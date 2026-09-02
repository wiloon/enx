// NOTE (ADR-011 issue #11 / #14): highlighting is painted with the CSS Custom
// Highlight API. This spec exercises ADR-011 Decision 3 / issue #13: the
// "Highlight vocabulary while reading" preference gates only the paint, and
// flipping it takes effect on an open page with no reload -- word-data lookup
// (click-to-translate) keeps working while the paint is off.

import { expect, test } from './fixtures'
import {
  clickHighlightedWord,
  enableLearningMode,
  getHighlightedWords,
  getHighlightedWordsCount,
  openOptions,
  openPopup,
  seedLoggedInState,
  waitForContentScript,
} from './helpers'

async function setHighlightPref(
  page: import('@playwright/test').Page,
  extensionId: string,
  enabled: boolean
) {
  const optionsPage = await page.context().newPage()
  await openOptions(optionsPage, extensionId)
  const toggle = optionsPage.locator('[data-testid="word-highlight-toggle"]')
  await expect(toggle).toBeVisible()
  if (enabled) await toggle.check()
  else await toggle.uncheck()
  // give chrome.storage.onChanged a beat to propagate to the content script
  await optionsPage.waitForTimeout(200)
  await optionsPage.close()
}

test.describe('Word highlight preference toggle', () => {
  test.beforeEach(async ({ page, extensionId }) => {
    const popupPage = await page.context().newPage()
    await openPopup(popupPage, extensionId)
    await seedLoggedInState(popupPage, { username: 'test-user' })
    await popupPage.close()

    // Start each test from the default-on state.
    await setHighlightPref(page, extensionId, true)

    await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)
  })

  test('turning the preference off clears every highlight without a reload', async ({
    page,
    extensionId,
  }) => {
    expect(await getHighlightedWordsCount(page)).toBeGreaterThan(0)

    await setHighlightPref(page, extensionId, false)

    await expect
      .poll(() => getHighlightedWordsCount(page), { timeout: 3000 })
      .toBe(0)
  })

  test('click-to-lookup still works while the highlight paint is off', async ({
    page,
    extensionId,
  }) => {
    // Capture a word's on-screen box while it is still painted.
    const words = await getHighlightedWords(page)
    expect(words.length).toBeGreaterThan(0)
    const target = words[0]

    await setHighlightPref(page, extensionId, false)
    await expect
      .poll(() => getHighlightedWordsCount(page), { timeout: 3000 })
      .toBe(0)

    // The delegated click-to-lookup listener is bound regardless of the paint.
    await page.mouse.click(target.x, target.y)
    await page.waitForSelector('#enx-word-popup', { timeout: 3000 })
    await expect(page.locator('#enx-word-popup')).toBeVisible()
  })

  test('turning the preference back on repopulates highlights without a reload', async ({
    page,
    extensionId,
  }) => {
    await setHighlightPref(page, extensionId, false)
    await expect
      .poll(() => getHighlightedWordsCount(page), { timeout: 3000 })
      .toBe(0)

    await setHighlightPref(page, extensionId, true)
    await expect
      .poll(() => getHighlightedWordsCount(page), { timeout: 3000 })
      .toBeGreaterThan(0)

    // and the repainted words are clickable again
    await clickHighlightedWord(page, 0)
    await expect(page.locator('#enx-word-popup')).toBeVisible()
  })
})
