import { expect, test } from './fixtures'
import { openOptions } from './helpers'

test.describe('Options Page', () => {
  test('shows the API server the extension was built for', async ({
    page,
    extensionId,
  }) => {
    await openOptions(page, extensionId)

    await expect(page.getByText('Current Environment')).toBeVisible()
    // The e2e build is a development build (build:e2e).
    await expect(page.getByText('http://localhost:8091')).toBeVisible()
  })

  // The API server is fixed at build time (#231): no switch on the page.
  test('offers no way to switch the API server', async ({
    page,
    extensionId,
  }) => {
    await openOptions(page, extensionId)
    await expect(page.getByText('Current Environment')).toBeVisible()

    await expect(page.locator('input#apiUrl')).toHaveCount(0)
    await expect(page.getByText(/API URL Configuration/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)
  })
})
