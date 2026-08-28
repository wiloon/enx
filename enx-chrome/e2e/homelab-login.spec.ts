import { expect, test } from './fixtures'
import { openPopup } from './helpers'

/**
 * Homelab login E2E.
 *
 * Run with:
 *   pnpm build                                        # dist/ -> VITE_ENV=staging (enx-api.wiloon.lab)
 *   ENX_HOMELAB=1 ENX_ACCESS_TOKEN=eyJ... pnpm test:e2e:homelab
 *
 * Get a token first from the browserless smoke test, which prints an
 * `export ENX_ACCESS_TOKEN=...` line on success:
 *   ENX_TEST_USERNAME=... ENX_TEST_PASSWORD=... node scripts/homelab-smoke.mjs
 *
 * Everything here is skipped unless ENX_HOMELAB=1.
 */

const HOMELAB = process.env.ENX_HOMELAB === '1'
const API_BASE_URL =
  process.env.ENX_API_BASE_URL || 'https://enx-api.wiloon.lab'
const ACCESS_TOKEN = process.env.ENX_ACCESS_TOKEN || ''

test.describe('Homelab - Cognito login', () => {
  test.skip(!HOMELAB, 'set ENX_HOMELAB=1 to run homelab E2E')

  test('extension ID matches the pinned manifest key', async ({
    extensionId,
  }) => {
    // launchWebAuthFlow builds its redirect URI from chrome.runtime.id.
    // If this ID is not in the Cognito app client callback URLs, sign-in
    // fails before Hosted UI ever loads. Pin it here so a broken build
    // (missing manifest "key") is caught loudly.
    expect(extensionId).toMatch(/^[a-p]{32}$/)
    console.log('extension id:', extensionId)
    console.log(
      'callback URL Cognito must allow:',
      `https://${extensionId}.chromiumapp.org/callback`
    )
  })

  test('seeded homelab token authenticates against enx-api.wiloon.lab', async ({
    page,
    extensionId,
  }) => {
    test.skip(
      !ACCESS_TOKEN,
      'set ENX_ACCESS_TOKEN (see scripts/homelab-smoke.mjs)'
    )

    await openPopup(page, extensionId)

    // Point the extension at homelab and seed the real Cognito token exactly
    // as handleCognitoSignIn() would have. background.ts has a
    // chrome.storage.onChanged listener that picks up accessToken.
    await page.evaluate(
      ({ apiBaseUrl, accessToken }) =>
        chrome.storage.local.set({
          apiBaseUrl,
          accessToken,
          user: {
            id: 1,
            username: 'homelab-e2e',
            email: 'homelab-e2e@example.com',
            isLoggedIn: true,
          },
        }),
      { apiBaseUrl: API_BASE_URL, accessToken: ACCESS_TOKEN }
    )

    // Ask background to hit the live /api/me -- this is the call that fails
    // in a broken homelab (503 auth-service-unavailable, or 401). Sent from
    // the popup page context so it reaches the service worker's onMessage.
    const result = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'validateSession' })
    )

    console.log('validateSession result:', JSON.stringify(result))
    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(result.data?.email).toBeTruthy()
  })

  test('popup shows the signed-in view after a valid session is seeded', async ({
    page,
    extensionId,
  }) => {
    test.skip(!ACCESS_TOKEN, 'set ENX_ACCESS_TOKEN')

    await openPopup(page, extensionId)
    await page.evaluate(
      ({ apiBaseUrl, accessToken }) =>
        chrome.storage.local.set({
          apiBaseUrl,
          accessToken,
          user: {
            id: 1,
            username: 'homelab-e2e',
            email: 'homelab-e2e@example.com',
            isLoggedIn: true,
          },
          'enx-user': {
            id: 1,
            username: 'homelab-e2e',
            email: 'homelab-e2e@example.com',
            isLoggedIn: true,
          },
        }),
      { apiBaseUrl: API_BASE_URL, accessToken: ACCESS_TOKEN }
    )

    await page.reload({ waitUntil: 'domcontentloaded' })

    await expect(page.getByText(/Welcome/)).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: /Enable Learning Mode|Enabling|Enabled/,
      })
    ).toBeVisible()
  })

  /**
   * Full interactive OAuth against real Cognito Hosted UI.
   *
   * Off by default: it needs a NATIVE Cognito user (email + password -- a
   * Google-federated account cannot be scripted past Google's bot checks),
   * ENX_TEST_USERNAME / ENX_TEST_PASSWORD, and it is inherently flaky
   * (Hosted UI markup, network, rate limits). Enable with ENX_OAUTH_LIVE=1.
   *
   * chrome.identity.launchWebAuthFlow opens its own window; Playwright sees it
   * as a new page on the context. We fill the Hosted UI form there. Chrome
   * intercepts the final chromiumapp.org redirect internally, so we assert on
   * the resulting extension state, not on a URL.
   */
  test('interactive Cognito Hosted UI sign-in', async ({
    context,
    page,
    extensionId,
  }) => {
    test.skip(
      process.env.ENX_OAUTH_LIVE !== '1',
      'set ENX_OAUTH_LIVE=1 (needs a native Cognito user)'
    )
    const username = process.env.ENX_TEST_USERNAME
    const password = process.env.ENX_TEST_PASSWORD
    test.skip(
      !username || !password,
      'set ENX_TEST_USERNAME / ENX_TEST_PASSWORD'
    )

    await openPopup(page, extensionId)
    await page.evaluate(
      apiBaseUrl => chrome.storage.local.set({ apiBaseUrl }),
      API_BASE_URL
    )

    // Clicking "Sign in" triggers action:cognitoSignIn in the service worker,
    // which calls launchWebAuthFlow -> a new window/page appears.
    const hostedUiPromise = context.waitForEvent('page', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Sign in' }).click()
    const hostedUi = await hostedUiPromise
    await hostedUi.waitForLoadState('domcontentloaded')

    // Cognito Hosted UI classic markup. Selectors are best-effort; adjust if
    // your Hosted UI is customised or you use the new managed login pages.
    await hostedUi
      .locator('input[name="username"], input[id*="signInFormUsername"]')
      .first()
      .fill(username!)
    await hostedUi
      .locator('input[name="password"], input[id*="signInFormPassword"]')
      .first()
      .fill(password!)
    await hostedUi
      .locator('input[type="submit"], button[type="submit"]')
      .first()
      .click()

    // Hosted UI window closes on the chromiumapp.org redirect; the SW finishes
    // the token exchange + /api/me. Poll extension storage for the result.
    await expect
      .poll(
        async () => {
          const [sw] = context.serviceWorkers()
          return sw.evaluate(async () => {
            const s = await chrome.storage.local.get(['accessToken', 'user'])
            return Boolean(s.accessToken && s.user?.isLoggedIn)
          })
        },
        { timeout: 30_000, intervals: [1000] }
      )
      .toBe(true)
  })
})
