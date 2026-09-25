import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import { openPopup } from './helpers'

// ADR-015: the popup never signs in itself (OAuth can't finish in a popup that
// closes on blur); it sends the user to the website and picks the session up
// through syncHost.
test.describe('Popup - Clerk sign-in', () => {
  test('shows the website sign-in entry point when signed out', async ({
    page,
    extensionId,
  }) => {
    await openPopup(page, extensionId)

    await expect(
      page.getByRole('heading', { name: 'Sign in to Catglish' })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Sign in on the website' })
    ).toBeVisible()
    // No credential form in the extension
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })
})

test.describe('Popup - signed in', () => {
  // Skipped at describe level so the signedIn fixture never runs without
  // credentials (a skip inside the test body would run after fixtures).
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('shows the signed-in popup once the website session is synced', async ({
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await openPopup(page, extensionId)

    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByRole('button', { name: 'Sign in on the website' })
    ).toHaveCount(0)
  })
})
