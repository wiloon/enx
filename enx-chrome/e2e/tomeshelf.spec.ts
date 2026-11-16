// ADR-088 / #907: tomeshelf SPA rebuild, late recognition, and badge stay on
// after an in-page document change.

import { loginAvailable, LOGIN_SKIP_REASON, FIXTURE_ORIGIN } from './auth'
import { expect, test } from './fixtures'
import {
  clickWord,
  enableLearningMode,
  mockBackendFetch,
  waitForContentScript,
} from './helpers'

async function badgeText(
  page: import('@playwright/test').Page,
  extensionId: string,
  tabUrl: string
): Promise<string> {
  const popup = await page.context().newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.waitForLoadState('domcontentloaded')
  const text = await popup.evaluate(async url => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find(t => t.url === url || t.url?.startsWith(url))
    if (!tab?.id) return ''
    return chrome.action.getBadgeText({ tabId: tab.id })
  }, tabUrl)
  await popup.close()
  return text
}

test.describe('tomeshelf EPUB reader (ADR-088)', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('click lookup and badge survive an in-page document change', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [
        ['fox', 1],
        ['zebra', 1],
      ],
    })
    await page.goto(`${FIXTURE_ORIGIN}/tomeshelf.html`, {
      waitUntil: 'domcontentloaded',
    })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const popover = await clickWord(page, 'fox', '#tomeshelf-content p')
    await expect(
      popover.getByTestId('word-popover-header').locator('h3')
    ).toHaveText('fox')
    await page.keyboard.press('Escape')

    await page.locator('#next-document').click()
    await expect(page.locator('#tomeshelf-content')).toContainText('zebra')
    await waitForContentScript(page)

    await clickWord(page, 'zebra', '#tomeshelf-content p')
    await expect(
      page.locator(
        '#enx-anchored-overlay [data-testid="word-popover-header"] h3'
      )
    ).toHaveText('zebra')

    await expect
      .poll(() => badgeText(page, extensionId, page.url()), { timeout: 5000 })
      .toBe('✓')
  })

  // Late meta after the content script starts (ADR-088 Decision 1). The
  // fixture origin is a required host permission, so Playwright cannot grant
  // "Always enable" via chrome.permissions.request (it returns false under
  // automation). Enable while the meta is still absent; when it appears,
  // late recognition cancels and re-enables as tomeshelf. Auto-enable + late
  // meta is covered in content-script tests (tomeshelf.test.ts).
  test('late meta after enable then survives document 2', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [
        ['fox', 1],
        ['zebra', 1],
      ],
    })

    await page.goto(`${FIXTURE_ORIGIN}/tomeshelf-late.html`, {
      waitUntil: 'domcontentloaded',
    })
    // Enable before the 400ms delayed meta/article insert.
    await enableLearningMode(page, extensionId)
    await expect(page.locator('#tomeshelf-content')).toBeVisible({
      timeout: 10_000,
    })
    await waitForContentScript(page)

    await clickWord(page, 'fox', '#tomeshelf-content p')
    await page.keyboard.press('Escape')

    await page.locator('#next-document').click()
    await expect(page.locator('#tomeshelf-content')).toContainText('zebra')
    await waitForContentScript(page)

    await clickWord(page, 'zebra', '#tomeshelf-content p')
    await expect
      .poll(() => badgeText(page, extensionId, page.url()), { timeout: 5000 })
      .toBe('✓')
  })
})
