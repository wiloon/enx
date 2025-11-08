import { expect, test } from './fixtures'
import { clearStorage, login, openPopup } from './helpers'

test.describe('Popup - Login', () => {
  test.beforeEach(async ({ page }) => {
    // Clear storage before each test
    await clearStorage(page)
  })

  test('should display login form when not logged in', async ({
    page,
    extensionId,
  }) => {
    await openPopup(page, extensionId)

    // Check login form elements
    await expect(page.locator('input[name="username"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test('should successfully login with valid credentials', async ({
    page,
    extensionId,
  }) => {
    await openPopup(page, extensionId)

    await login(page, 'wiloon', 'haCahpro')

    // Should show welcome message
    await expect(page.locator('text=/Welcome/')).toBeVisible()
  })

  test('should show error with invalid credentials', async ({
    page,
    extensionId,
  }) => {
    await openPopup(page, extensionId)

    // Fill in wrong credentials
    await page.fill('input[name="username"]', 'wronguser')
    await page.fill('input[name="password"]', 'wrongpass')
    await page.click('button[type="submit"]')

    // Should show error message (in the error div)
    await expect(
      page.locator('.bg-red-100, .text-red-700, [role="alert"]')
    ).toBeVisible({ timeout: 10000 })
  })

  test('should remember login state after popup reopens', async ({
    page,
    extensionId,
  }) => {
    await openPopup(page, extensionId)
    await login(page, 'wiloon', 'haCahpro')

    // Close and reopen popup
    await page.close()
    const newPage = await page.context().newPage()
    await openPopup(newPage, extensionId)

    // Should still be logged in
    await expect(newPage.locator('text=/Welcome/')).toBeVisible()
  })
})
