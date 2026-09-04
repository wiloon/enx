import { test, expect } from '@playwright/test'

test.describe('marketing landing', () => {
  test('/ is the public landing page, not the login form', async ({ page }) => {
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: /learn english while you read the web/i })
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: /add to chrome/i }).first()
    ).toBeVisible()
    // No inline sign-in widget on the landing page.
    await expect(page.locator('.cl-signIn-root')).toHaveCount(0)
  })

  test('the comparison table names Catseye and a competitor', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('columnheader', { name: 'Catseye' })).toBeVisible()
    await expect(
      page.getByRole('columnheader', { name: 'Immersive Translate' })
    ).toBeVisible()
  })
})

test.describe('Clerk sign in (ADR-015)', () => {
  test('/app redirects a signed-out visitor to /sign-in', async ({ page }) => {
    await page.goto('/app')
    await page.waitForURL(/\/sign-in(\/|\?|$)/, { timeout: 15000 })
    expect(new URL(page.url()).pathname).toMatch(/^\/sign-in/)
  })

  test('/sign-in renders the Clerk sign-in widget', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.locator('.cl-signIn-root, .cl-rootBox').first()).toBeVisible({
      timeout: 15000,
    })
  })

  // The exact regression from the first Clerk deploy: Clerk derives its OAuth
  // callback as `<sign-in path>/sso-callback`. That route must resolve (Clerk's
  // catch-all handles it) — a 404 here means an OAuth login dead-ends after the
  // provider redirects back. See src/__tests__/clerk-routing.test.ts.
  test('/sign-in/sso-callback resolves (no 404)', async ({ page }) => {
    const res = await page.goto('/sign-in/sso-callback')
    expect(res?.status()).not.toBe(404)
  })

  test('/app/sso-callback is NOT a route (nothing should mount SignIn there)', async ({
    page,
  }) => {
    const res = await page.goto('/app/sso-callback')
    expect(res?.status()).toBe(404)
  })
})
