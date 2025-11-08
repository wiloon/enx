import { expect, test } from './fixtures'
import {
    clickWordAndWaitForPopup,
    enableLearningMode,
    login,
    openPopup,
    waitForContentScript,
} from './helpers'

test.describe('Content Script - Translation Popup', () => {
  test.beforeEach(async ({ page, extensionId }) => {
    // Login
    const popupPage = await page.context().newPage()
    await openPopup(popupPage, extensionId)
    await login(popupPage, 'wiloon', 'haCahpro')
    await popupPage.close()

    // Navigate and enable learning mode on local test page
    await page.goto('/test-page.html', {
      waitUntil: 'domcontentloaded',
    })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)
  })

  test('should show translation popup when clicking highlighted word', async ({
    page,
  }) => {
    // Click first highlighted word
    await clickWordAndWaitForPopup(page, 0)

    // Check popup is visible
    const popup = page.locator('#enx-word-popup')
    await expect(popup).toBeVisible()
  })

  test('translation popup should contain word and translation', async ({
    page,
  }) => {
    await clickWordAndWaitForPopup(page, 0)

    const popup = page.locator('#enx-word-popup')

    // Should show the word in header
    await expect(popup.locator('.enx-popup-header h3')).toBeVisible()

    // Should show translation content or loading state
    await expect(popup.locator('.enx-popup-content')).toBeVisible()
  })

  test('should close translation popup when clicking outside', async ({
    page,
  }) => {
    await clickWordAndWaitForPopup(page, 0)

    // Popup should be visible
    await expect(page.locator('#enx-word-popup')).toBeVisible()

    // Wait for click-outside handler to be attached (100ms timeout in content script)
    await page.waitForTimeout(150)

    // Click on an empty area (header of page)
    const header = page.locator('h1').first()
    await header.click()

    // Wait for popup to be removed
    await page.waitForSelector('#enx-word-popup', { state: 'detached', timeout: 2000 })

    // Double-check it's not visible
    const popup = page.locator('#enx-word-popup')
    const exists = await popup.count()
    expect(exists).toBe(0)
  })

  test('should show different translations for different words', async ({
    page,
  }) => {
    // Click first word
    await clickWordAndWaitForPopup(page, 0)
    const firstWord = await page
      .locator('#enx-word-popup .enx-popup-header h3')
      .textContent()

    // Close popup
    await page.click('body', { position: { x: 10, y: 10 } })
    await page.waitForTimeout(300)

    // Click second word
    await clickWordAndWaitForPopup(page, 1)
    const secondWord = await page
      .locator('#enx-word-popup .enx-popup-header h3')
      .textContent()

    // Words should be different
    expect(firstWord).not.toBe(secondWord)
  })
})
