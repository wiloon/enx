import { test, expect } from '@playwright/test'

// The public pricing page (LAUNCH-CHECKLIST §7.3). All signed out: the point
// of the page is that a visitor -- and Stripe's reviewer -- sees prices
// without an account. Checkout itself is covered by billing.spec.ts.

const card = (page: import('@playwright/test').Page, title: string) =>
  page.locator('[data-slot="card"]').filter({
    has: page
      .locator('[data-slot="card-title"]')
      .filter({ hasText: new RegExp(`^${escapeRegExp(title)}$`) }),
  })

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('/pricing (signed out)', () => {
  test('shows plans and top-ups without signing in', async ({ page }) => {
    await page.goto('/pricing')

    await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible()
    // Prices come from lib/plans.ts and must mirror the Stripe catalog.
    await expect(card(page, 'Catglish Pro+')).toContainText('$9.99/mo')
    await expect(card(page, 'Catglish Pro+')).toContainText('1,500 credits/mo')
    await expect(card(page, 'Small top-up')).toContainText('$2.99')
    await expect(card(page, 'Free')).toContainText('$0')
    // Stub API returns 1234 (playwright webServer); formatted with en-US commas.
    await expect(card(page, 'Free')).toContainText('up to 1,234 lookups a day')
    // Stub API returns trial terms (#1238); note fits with the trial line.
    await expect(card(page, 'Free')).toContainText(
      'New accounts get 100 free AI credits, valid for 30 days'
    )
    await expect(card(page, 'Free')).toContainText(
      'AI translation uses credits from a trial, a plan, or a top-up.'
    )
    for (const name of ['Catglish Pro', 'Catglish Pro+', 'Catglish Max']) {
      await expect(card(page, name)).not.toContainText(/lookups? a day/i)
    }
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /Paid plans add monthly AI translation credits\./
    )
    // Not redirected to sign-in.
    await expect(page).toHaveURL(/\/pricing$/)
  })

  test('a plan CTA leads to sign-up, not to Stripe', async ({ page }) => {
    await page.goto('/pricing')

    await card(page, 'Catglish Pro')
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
