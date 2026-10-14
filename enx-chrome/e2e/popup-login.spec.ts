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

test.describe('Popup - version footer', () => {
  test('shows the installed version, signed out too, with build details on hover', async ({
    page,
    extensionId,
  }) => {
    await openPopup(page, extensionId)
    const version = await page.evaluate(
      () => chrome.runtime.getManifest().version
    )

    const footer = page.getByRole('button', { name: `v${version}` })
    await expect(footer).toBeVisible()
    await expect(footer).toHaveAttribute(
      'title',
      new RegExp(
        `^Catglish v${version.replace(/\./g, '\\.')} .*\\nCommit [0-9a-f]{7,}\\nBuilt `
      )
    )
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

test.describe('Popup - sign out', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('signs out in place, without reloading the popup', async ({
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await openPopup(page, extensionId)
    const signOut = page.getByRole('button', { name: 'Sign out' })
    await expect(signOut).toBeVisible({ timeout: 15_000 })

    // A reload would make Clerk start over (reload clerk-js, refetch the
    // environment and client) before the sign-in card could show.
    let navigations = 0
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) navigations++
    })

    await signOut.click()

    await expect(
      page.getByRole('button', { name: 'Sign in on the website' })
    ).toBeVisible({ timeout: 15_000 })
    expect(navigations).toBe(0)
  })
})
