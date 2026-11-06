import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import { SITE } from '../src/lib/site'

// First-run onboarding (ADR-047). /welcome must work signed out: a user who
// installs from the Chrome Web Store usually has no account yet.

test.describe('/welcome (signed out)', () => {
  test('shows sign-in and the sample article without redirecting', async ({
    page,
  }) => {
    await page.goto('/welcome')

    await expect(
      page.getByRole('heading', { name: /sign in to get started/i })
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })
    ).toBeVisible()
    await expect(page.locator('#enx-reader-article p').first()).toBeVisible()
    await expect(page).toHaveURL(/\/welcome$/)
  })
})

test.describe('/welcome (signed in)', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('ticks the sign-in step', async ({ page, signedIn }) => {
    void signedIn
    // A new user: never finished onboarding, no lookups yet.
    await page.route('**/api/me/preferences', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          onboardingCompleted: {
            value: null,
            effective: false,
            editable: true,
          },
        }),
      })
    )
    await page.route('**/api/stats/overview**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ vocab: { total: 0, mastered: 0 } }),
      })
    )

    await page.goto('/welcome')

    const signIn = page.getByRole('listitem').filter({ hasText: 'Sign in' })
    await expect(signIn.getByLabel('Done')).toBeVisible()
  })
})

// The extension messaging API is a browser boundary. These checks render the
// real page; extension installation itself is covered by the extension suite.
test('detects installation without flashing a guessed result, and updates after installing', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let installed: boolean | undefined
    window.addEventListener('test:extension-status', (event) => {
      installed = (event as CustomEvent<boolean>).detail
    })
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: (
            _id: string,
            _message: unknown,
            callback: (response: unknown) => void
          ) => {
            const answer = () =>
              callback({ ok: installed === true, isOnToolbar: false })
            if (installed === undefined) {
              window.addEventListener('test:extension-status', answer, {
                once: true,
              })
            } else answer()
          },
        },
      },
    })
  })
  await page.goto('/welcome', { waitUntil: 'domcontentloaded' })
  await expect(
    page.getByRole('status', { name: 'Checking extension' })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add to Chrome' })).toHaveCount(0)
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/welcome-checking.png',
  })
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test:extension-status', { detail: false })
    )
  )
  const install = page.getByRole('link', { name: 'Add to Chrome' })
  await expect(install).toHaveAttribute('href', SITE.chromeWebStoreUrl)
  await expect(install).toHaveAttribute('target', '_blank')
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      colorScheme === 'dark'
    )
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(install).toBeInViewport()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.screenshot({
      path: `test-results/welcome-install-${colorScheme}-mobile.png`,
    })
  }
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test:extension-status', { detail: true })
    )
  )
  await expect(page.getByText('Catglish extension installed')).toBeVisible()
  await expect(install).toHaveCount(0)
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/welcome-installed-status.png',
  })
  await page.getByRole('link', { name: 'Next: finish setup' }).click()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeInViewport()
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/welcome-installed-mobile.png',
  })
})

test.describe('post-authentication Home destination', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  for (const completed of [false, true]) {
    test(
      completed
        ? 'keeps skipped setup on Home'
        : 'takes a new user directly to Welcome',
      async ({ page, signedIn }) => {
        void signedIn
        await page.route('**/api/me/preferences', (route) =>
          route.fulfill({
            json: {
              onboardingCompleted: {
                effective: completed,
                value: completed,
                editable: false,
              },
            },
          })
        )
        await page.route('**/api/stats/overview**', (route) =>
          route.fulfill({
            json: { vocab: { total: 0, mastered: 0 } },
          })
        )
        await page.goto('/app')
        if (completed) {
          await expect(
            page.getByRole('heading', { name: 'Try Catglish in 1 minute' })
          ).toBeVisible()
          await expect(page).toHaveURL(/\/app$/)
        } else {
          await expect(page).toHaveURL(/\/welcome$/)
          await expect(
            page.getByRole('link', { name: 'Add to Chrome' })
          ).toBeVisible()
          for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme })
            await page.evaluate(
              (dark) => document.documentElement.classList.toggle('dark', dark),
              colorScheme === 'dark'
            )
            await page.setViewportSize({ width: 1280, height: 900 })
            await page.screenshot({
              path: `test-results/welcome-new-user-${colorScheme}.png`,
            })
          }
        }
      }
    )
  }
})
