import { test, expect } from '@playwright/test'

// The sample article (ADR-047 Decision 8). Signed out on purpose: first-run
// onboarding sends people here before they have signed in.

test.describe('/reader/sample (signed out)', () => {
  test('shows the article without signing in', async ({ page }) => {
    await page.goto('/reader/sample')

    await expect(
      page.getByRole('heading', { name: 'The Quiet Power of a Short Walk' })
    ).toBeVisible()
    await expect(page.locator('#enx-reader-article p')).toHaveCount(4)
    // Not redirected to sign-in.
    await expect(page).toHaveURL(/\/reader\/sample$/)
  })
})
