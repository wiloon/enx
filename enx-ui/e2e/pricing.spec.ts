import { test, expect } from '@playwright/test'

// The public pricing page (LAUNCH-CHECKLIST §7.3). All signed out: the point
// of the page is that a visitor -- and Stripe's reviewer -- sees prices
// without an account. Checkout itself is covered by billing.spec.ts.

const card = (page: import('@playwright/test').Page, text: string) =>
  page.locator('[data-slot="card"]').filter({ hasText: text })

test.describe('/pricing (signed out)', () => {
  test('shows plans and top-ups without signing in', async ({ page }) => {
    await page.goto('/pricing')

    await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible()
    // Prices come from lib/plans.ts and must mirror the Stripe catalog.
    await expect(card(page, 'Catglish Pro+')).toContainText('$9.99/mo')
    await expect(card(page, 'Catglish Pro+')).toContainText('1,500 credits/mo')
    await expect(card(page, 'Small top-up')).toContainText('$2.99')
    await expect(card(page, 'Free')).toContainText('$0')
    await expect(card(page, 'Free')).toContainText('200 lookups a day')
    // Not redirected to sign-in.
    await expect(page).toHaveURL(/\/pricing$/)
  })

  test('a plan CTA leads to sign-up, not to Stripe', async ({ page }) => {
    await page.goto('/pricing')

    await card(page, 'Catglish Pro')
      .first()
      .getByRole('link', { name: 'Subscribe' })
      .click()
    await page.waitForURL(/\/sign-up/)
    expect(new URL(page.url()).pathname).toMatch(/^\/sign-up/)
  })

  test('the landing page links to it from the header', async ({ page }) => {
    await page.goto('/')

    await page
      .getByRole('banner')
      .getByRole('link', { name: 'Pricing' })
      .click()
    await expect(page).toHaveURL(/\/pricing$/)
  })
})
