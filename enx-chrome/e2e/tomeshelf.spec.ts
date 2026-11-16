// ADR-088 / #907: tomeshelf SPA rebuild, late recognition, and badge stay on
// after an in-page document change.

import path from 'path'
import { fileURLToPath } from 'url'
import { loginAvailable, LOGIN_SKIP_REASON, FIXTURE_ORIGIN } from './auth'
import { expect, test } from './fixtures'
import {
  clickWord,
  enableLearningMode,
  mockBackendFetch,
  waitForContentScript,
} from './helpers'

const ORIGIN = 'https://books.tomeshelf.test'
const LATE_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'test-fixtures',
  'tomeshelf-late.html'
)

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

async function grantAutoEnable(
  page: import('@playwright/test').Page,
  extensionId: string
): Promise<boolean> {
  await page.bringToFront()
  const popup = await page.context().newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.waitForLoadState('domcontentloaded')
  const toggle = popup.getByTestId('popup-auto-enable-site-toggle')
  await expect(toggle).toBeAttached({ timeout: 15_000 })
  if (await toggle.isChecked()) {
    await popup.close()
    return true
  }
  await toggle.click()
  // permissions.request is synchronous for the gesture; give the toggle a
  // beat to reflect the grant (or a denial under automation).
  await popup.waitForTimeout(500)
  const granted = await toggle.isChecked()
  await popup.close()
  return granted
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

  test('auto-enable with late meta then survives document 2', async ({
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

    const lateUrl = `${ORIGIN}/books/x/read/1`
    await context.route(`${ORIGIN}/**`, async route => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname.includes('/read/')) {
        await route.fulfill({
          path: LATE_FIXTURE,
          contentType: 'text/html; charset=utf-8',
        })
        return
      }
      await route.fulfill({ status: 404 })
    })

    await page.goto(lateUrl, { waitUntil: 'domcontentloaded' })
    const granted = await grantAutoEnable(page, extensionId)
    test.skip(!granted, 'chrome.permissions.request did not grant the origin')

    // Reload so the registered auto-enable content script starts before the
    // late meta appears.
    await page.goto(lateUrl, { waitUntil: 'domcontentloaded' })
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
