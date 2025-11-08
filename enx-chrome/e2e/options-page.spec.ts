import { expect, test } from './fixtures'
import { openOptions } from './helpers'

test.describe('Options Page', () => {
  test('should display options page with API configuration', async ({
    page,
    extensionId,
  }) => {
    await openOptions(page, extensionId)

    // Check for API URL input
    await expect(
      page.locator('input[name="apiUrl"], input#apiUrl')
    ).toBeVisible()

    // Check for save button
    await expect(page.locator('button:has-text("Save")')).toBeVisible()
  })

  test('should save API URL configuration', async ({ page, extensionId }) => {
    await openOptions(page, extensionId)

    const customUrl = 'http://localhost:9999'

    // Fill in custom API URL
    const apiInput = page.locator('input[name="apiUrl"], input#apiUrl')
    await apiInput.clear()
    await apiInput.fill(customUrl)

    // Click save
    await page.click('button:has-text("Save")')

    // Should show success message
    await expect(page.locator('text=/Saved|Success/i')).toBeVisible({
      timeout: 3000,
    })

    // Reload page and check value persists
    await page.reload()
    await expect(apiInput).toHaveValue(customUrl)
  })

  test('should show default API URL when no custom URL is set', async ({
    page,
    extensionId,
  }) => {
    // Clear storage first (using helper function)
    await page.evaluate(() => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        return chrome.storage.local.clear()
      }
      return Promise.resolve()
    })

    await openOptions(page, extensionId)

    // Should show default URL from .env
    const apiInput = page.locator('input[name="apiUrl"], input#apiUrl')
    const value = await apiInput.inputValue()

    // Should be default (dev, staging, or prod)
    expect(value).toMatch(
      /http:\/\/localhost:8090|https:\/\/enx\.wiloon\.com|https:\/\/enx-api\.wiloon\.com/
    )
  })

  test('should reset to default URL', async ({ page, extensionId }) => {
    await openOptions(page, extensionId)

    // Set custom URL
    const apiInput = page.locator('input[name="apiUrl"], input#apiUrl')
    await apiInput.clear()
    await apiInput.fill('http://custom.example.com')
    await page.click('button:has-text("Save")')

    // Wait for save to complete
    await page.waitForTimeout(500)

    // Click reset button
    const resetButton = page.locator('button:has-text("Reset")')
    await resetButton.click()

    // Wait for reset to complete and check success message
    await expect(page.locator('text=/Reset to default/i')).toBeVisible({
      timeout: 3000,
    })

    // Wait a bit for the input to update
    await page.waitForTimeout(500)

    // Should show default URL
    const value = await apiInput.inputValue()
    expect(value).toMatch(
      /http:\/\/localhost:8090|https:\/\/enx\.wiloon\.com|https:\/\/enx-api\.wiloon\.com/
    )
  })
})
