import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'

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
    await expect(page.locator('#enx-reader-article p')).toHaveCount(4)
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
