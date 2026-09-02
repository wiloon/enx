import { expect, test } from './fixtures'
import {
  enableLearningMode,
  getHighlightedWordsCount,
  waitForContentScript,
} from './helpers'

/**
 * X (twitter) in-page tweet-switch auto-rebuild -- ADR-011 Decision 5 / issue #12.
 *
 * On x.com the content script picks its site adapter from the *real* page URL
 * (resolveSiteAdapter over location.hostname), so the SPA-rebuild path only
 * engages on an actual x.com document -- a look-alike fixture served from
 * localhost won't trigger it. This spec therefore lives in the homelab lane
 * (playwright.homelab.config.ts, matched by `homelab-*.spec.ts`) and is skipped
 * unless ENX_HOMELAB=1.
 *
 * Run with:
 *   pnpm build
 *   ENX_HOMELAB=1 \
 *   ENX_API_BASE_URL=https://enx-api.wiloon.lab \
 *   ENX_ACCESS_TOKEN=eyJ... \
 *   ENX_X_TWEET_URL='https://x.com/<user>/status/<id>' \
 *     pnpm test:e2e:homelab
 *
 * Get ENX_ACCESS_TOKEN from scripts/homelab-smoke.mjs (same as homelab-login).
 * Pick ENX_X_TWEET_URL as an English-language tweet whose detail view shows at
 * least one reply / quoted tweet you can click through to without logging into
 * x.com. The jest suite covers the pure rebuild logic
 * (src/content/__tests__/spaRebuild.test.ts); this is the live end-to-end wiring.
 */

const HOMELAB = process.env.ENX_HOMELAB === '1'
const API_BASE_URL = process.env.ENX_API_BASE_URL || 'https://enx-api.wiloon.lab'
const ACCESS_TOKEN = process.env.ENX_ACCESS_TOKEN || ''
const TWEET_URL = process.env.ENX_X_TWEET_URL || ''

test.describe('Homelab - X tweet-switch auto-rebuild', () => {
  test.skip(!HOMELAB, 'set ENX_HOMELAB=1 to run homelab E2E')

  test('switching to another tweet rebuilds highlights with no full navigation', async ({
    page,
    extensionId,
  }) => {
    test.skip(
      !ACCESS_TOKEN || !TWEET_URL,
      'set ENX_ACCESS_TOKEN and ENX_X_TWEET_URL'
    )

    // Seed the enx session the same way homelab-login.spec.ts does -- from an
    // extension page, so chrome.storage is reachable.
    const seedPage = await page.context().newPage()
    await seedPage.goto(`chrome-extension://${extensionId}/popup.html`)
    await seedPage.waitForLoadState('domcontentloaded')
    await seedPage.evaluate(
      ({ apiBaseUrl, accessToken }) =>
        chrome.storage.local.set({
          apiBaseUrl,
          accessToken,
          user: { id: 1, username: 'homelab-e2e', isLoggedIn: true },
          'enx-user': { id: 1, username: 'homelab-e2e', isLoggedIn: true },
        }),
      { apiBaseUrl: API_BASE_URL, accessToken: ACCESS_TOKEN }
    )
    await seedPage.close()

    // 1. Open the tweet permalink and highlight its text.
    await page.goto(TWEET_URL, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)
    const firstCount = await getHighlightedWordsCount(page)
    expect(firstCount).toBeGreaterThan(0)
    const firstUrl = page.url()

    // 2. Click through to a different status from within the page (a reply or
    //    quoted tweet). x.com routes this via the History API -- no reload.
    const otherStatus = page
      .locator(`article a[href*="/status/"]`)
      .filter({ hasNot: page.locator(`[href="${new URL(firstUrl).pathname}"]`) })
      .first()
    await otherStatus.scrollIntoViewIfNeeded()
    await Promise.all([
      page.waitForURL((u) => u.toString() !== firstUrl, { timeout: 15000 }),
      otherStatus.click(),
    ])

    // 3. The SPA rebuilder should tear down the old paint and highlight the new
    //    tweet -- within ~1s, without a document navigation.
    await expect
      .poll(() => getHighlightedWordsCount(page), { timeout: 5000 })
      .toBeGreaterThan(0)

    // 4. Browser Back is a 'traverse' navigate -- highlights rebuild for the
    //    tweet we return to.
    await Promise.all([
      page.waitForURL(firstUrl, { timeout: 15000 }),
      page.goBack(),
    ])
    await expect
      .poll(() => getHighlightedWordsCount(page), { timeout: 5000 })
      .toBeGreaterThan(0)
  })
})
