import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import { SITE } from '../src/lib/site'

// First-run onboarding (ADR-047). /welcome must work signed out: a user who
// installs from the Chrome Web Store usually has no account yet.

test.describe('/welcome (signed out)', () => {
  test('shows all steps in one column without the article', async ({
    page,
  }) => {
    await page.goto('/welcome')
    await expect(
      page.getByRole('heading', { name: 'Welcome to Catglish', exact: true })
    ).toBeVisible()
    const steps = page.locator('ol > li')
    await expect(steps).toHaveCount(5)
    await expect(steps.locator('p').first()).toHaveText(
      'Add Catglish to Chrome'
    )
    await expect(
      page.getByRole('link', { name: 'Add to Chrome' })
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Continue', exact: true })
    ).toHaveCount(0)
    await expect(
      page.getByRole('region', { name: 'Sample article' })
    ).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })
    ).toHaveCount(0)
    await expect(page).toHaveURL(/\/welcome$/)
  })

  test('asks a pinned installer to create a free account with one Continue', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'chrome', {
        configurable: true,
        value: {
          runtime: {
            sendMessage: (
              _id: string,
              _message: unknown,
              callback: (response: unknown) => void
            ) => callback({ ok: true, isOnToolbar: true }),
          },
        },
      })
    })
    await page.goto('/welcome?src=install')

    const current = page.locator('[aria-current="step"]')
    await expect(current.locator('p').first()).toHaveText(
      'Create your free account'
    )
    await expect(
      current.getByText(
        'Free to start. Your saved words follow you to any device.'
      )
    ).toBeVisible()
    await expect(current.getByRole('link')).toHaveCount(1)
    await expect(
      current.getByRole('link', { name: 'Continue', exact: true })
    ).toHaveAttribute(
      'href',
      `/sign-in?redirect_url=${encodeURIComponent('/welcome?src=install')}`
    )
    await expect(page.getByRole('link', { name: /sign up/i })).toHaveCount(0)
  })
})

test.describe('/welcome (signed in)', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('finishes with a primary dashboard exit after the recommended sites', async ({
    page,
    signedIn,
  }) => {
    void signedIn
    await page.route('**/api/me/preferences', (route) =>
      route.fulfill({
        json: {
          onboardingCompleted: {
            value: true,
            effective: true,
            editable: false,
          },
        },
      })
    )
    await page.route('**/api/stats/overview**', (route) =>
      route.fulfill({
        json: {
          vocab: { total: 12, mastered: 0 },
          today: { wordsRead: 0, wordLookups: 0 },
          week: { wordsRead: 0 },
          sparkline: [],
        },
      })
    )
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/welcome')
    const heading = page.getByRole('heading', {
      name: "You're all set",
      exact: true,
    })
    await expect(heading).toBeVisible()
    const dashboard = page.getByRole('link', {
      name: 'Go to your dashboard',
      exact: true,
    })
    await expect(dashboard).toHaveAttribute('href', '/app')
    await expect(dashboard.locator('svg')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
    const sites = page.getByRole('link', { name: /\(opens in a new tab\)$/ })
    await expect(sites).toHaveCount(6)
    for (const link of await sites.all()) {
      await expect(link).toHaveAttribute('target', '_blank')
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      await expect(link.locator('svg')).toBeVisible()
    }
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        colorScheme === 'dark'
      )
      await expect(dashboard).toBeInViewport()
      const buttonBox = await dashboard.boundingBox()
      const sitesBox = await sites.last().boundingBox()
      expect(buttonBox!.y).toBeGreaterThan(sitesBox!.y + sitesBox!.height)
      const brand = await heading
        .locator('svg')
        .evaluate((el) => getComputedStyle(el).color)
      await expect(dashboard).toHaveCSS('background-color', brand)
      const background = await dashboard.evaluate(
        (el) => getComputedStyle(el).backgroundColor
      )
      expect(background).not.toBe(
        await dashboard.evaluate((el) => getComputedStyle(el).color)
      )
      await page.screenshot({
        path: `test-results/welcome-finished-${colorScheme}.png`,
        animations: 'disabled',
      })
    }
    await dashboard.click()
    await expect(page).toHaveURL(/\/app$/)
    await expect(
      page.getByRole('heading', { name: 'Today', exact: true })
    ).toBeVisible()
  })

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

    await page.addInitScript(() => {
      Object.defineProperty(window, 'chrome', {
        configurable: true,
        value: {
          runtime: {
            sendMessage: (
              _id: string,
              _message: unknown,
              callback: (response: unknown) => void
            ) => callback({ ok: true, isOnToolbar: false }),
          },
        },
      })
    })
    await page.goto('/welcome')

    const signIn = page.getByRole('listitem').filter({ hasText: 'Sign in' })
    await expect(signIn.getByLabel('Done')).toBeVisible()
    const article = page.getByRole('region', { name: 'Sample article' })
    await expect(article).toBeVisible()
    await expect(
      article.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })
    ).toBeVisible()
    await expect(
      page.getByRole('img', { name: /Chrome toolbar/ })
    ).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    const guide = page
      .getByRole('heading', { name: 'Welcome to Catglish', exact: true })
      .locator('..')
    const left = await guide.boundingBox()
    const right = await article.boundingBox()
    expect(left).not.toBeNull()
    expect(right).not.toBeNull()
    expect(right!.x).toBeGreaterThan(left!.x + left!.width)
    await page.screenshot({
      path: 'test-results/welcome-signed-in-desktop.png',
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 375, height: 812 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: 'test-results/welcome-signed-in-375.png',
      animations: 'disabled',
    })
  })

  test('points the current lookup hint at the article across the layout breakpoint', async ({
    page,
    signedIn,
  }) => {
    void signedIn
    await page.route('**/api/me/preferences', (route) =>
      route.fulfill({
        json: {
          onboardingCompleted: {
            value: null,
            effective: false,
            editable: true,
          },
        },
      })
    )
    await page.route('**/api/stats/overview**', (route) =>
      route.fulfill({ json: { vocab: { total: 0, mastered: 0 } } })
    )
    await page.addInitScript(() => {
      Object.defineProperty(window, 'chrome', {
        configurable: true,
        value: {
          runtime: {
            sendMessage: (
              _id: string,
              _message: unknown,
              callback: (response: unknown) => void
            ) => callback({ ok: true, isOnToolbar: true }),
          },
        },
      })
    })
    await page.goto('/welcome')
    const current = page.locator('[aria-current="step"]')
    await expect(current).toContainText('Turn on Catglish')
    await expect(
      current.getByText(
        'Click the Catglish icon in your toolbar, then Read with Catglish.'
      )
    ).toBeVisible()
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-enx-learning', 'on')
    )
    await expect(current).toHaveCount(1)
    await expect(current).toContainText('Click any word in the article')
    const rightHint = current.getByText(
      'Try any word in the article on the right →'
    )
    const belowHint = current.getByText('Try any word in the article below ↓')
    const article = page.getByRole('region', { name: 'Sample article' })
    for (const width of [1280, 768, 767, 375]) {
      await page.setViewportSize({ width, height: 900 })
      if (width >= 768) {
        await expect(rightHint).toBeVisible()
        await expect(belowHint).toBeHidden()
        const guideBox = await current.boundingBox()
        const articleBox = await article.boundingBox()
        expect(articleBox!.x).toBeGreaterThan(guideBox!.x + guideBox!.width)
      } else {
        await expect(belowHint).toBeVisible()
        await expect(rightHint).toBeHidden()
        const guideBox = await current.boundingBox()
        const articleBox = await article.boundingBox()
        expect(articleBox!.y).toBeGreaterThan(guideBox!.y + guideBox!.height)
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
    }
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
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('test:extension-status', { detail: true })
    )
  )
  await expect(page.getByText('Catglish extension installed')).toBeVisible()
  await expect(page.locator('ol > li')).toHaveCount(5)
  await expect(
    page.getByRole('region', { name: 'Sample article' })
  ).toHaveCount(0)
  const done = page.locator('ol > li').first()
  await expect(done.getByLabel('Done')).toBeVisible()
  const current = page.locator('ol > li').nth(1)
  await expect(current.getByText('Pin the Catglish icon')).toBeVisible()
  const skipPin = current.getByRole('button', { name: 'Skip', exact: true })
  await expect(skipPin).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Continue', exact: true })
  ).toHaveCount(0)
  const styles = await page.locator('ol > li > div > p').evaluateAll((titles) =>
    titles.map((title) => ({
      color: getComputedStyle(title).color,
      weight: getComputedStyle(title).fontWeight,
    }))
  )
  expect(styles[0].color).toBe(styles[2].color)
  expect(styles[1].color).not.toBe(styles[2].color)
  expect(styles[1].weight).toBe('500')
  expect(
    await done.evaluate((el) => getComputedStyle(el).backgroundColor)
  ).toBe('rgba(0, 0, 0, 0)')
  await expect(page.locator('[aria-current="step"]')).toHaveCount(1)
  await expect(install).toHaveCount(0)
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/welcome-installed-status.png',
  })
  await expect(
    page.getByRole('button', { name: 'Next: finish setup' })
  ).toHaveCount(0)
  await expect(skipPin).toBeInViewport()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: 'test-results/welcome-pin-mobile.png',
    animations: 'disabled',
  })
  await skipPin.click()
  await expect(current.getByLabel('Skipped')).toBeVisible()
  await expect(
    page
      .locator('ol > li')
      .nth(2)
      .getByRole('link', { name: 'Continue', exact: true })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /sign up/i })).toHaveCount(0)
  await expect(skipPin).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'Continue', exact: true })
  ).toBeInViewport()
  await page.screenshot({
    animations: 'disabled',
    path: 'test-results/welcome-installed-mobile.png',
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({
    path: 'test-results/welcome-signed-out-desktop.png',
    animations: 'disabled',
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
