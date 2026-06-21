import { expect, test } from './fixtures'
import { clearStorage, openPopup } from './helpers'

test.describe('Popup - Cognito login', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('shows Cognito sign in entry point when logged out', async ({
    page,
    extensionId,
  }) => {
    await openPopup(page, extensionId)

    await expect(page.getByRole('heading', { name: 'ENX Sign in' })).toBeVisible()
    await expect(
      page.getByText('Sign in with email or Google (AWS Cognito).')
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('does not show legacy username/password form', async ({
    page,
    extensionId,
  }) => {
    await openPopup(page, extensionId)

    await expect(page.locator('input[name="username"]')).toHaveCount(0)
    await expect(page.locator('input[name="password"]')).toHaveCount(0)
    await expect(page.locator('button[type="submit"]')).toHaveCount(0)
  })
})
