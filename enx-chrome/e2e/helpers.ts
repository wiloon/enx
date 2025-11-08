import { Page } from '@playwright/test'

/**
 * Helper utilities for E2E tests
 */

/**
 * Navigate to extension popup
 */
export async function openPopup(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.waitForLoadState('domcontentloaded')
}

/**
 * Navigate to extension options page
 */
export async function openOptions(page: Page, extensionId: string) {
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  await page.waitForLoadState('domcontentloaded')
}

/**
 * Login to the extension
 */
export async function login(
  page: Page,
  username: string = 'wiloon',
  password: string = 'haCahpro'
) {
  // Wait for login form
  await page.waitForSelector('input[name="username"]', { timeout: 5000 })

  // Fill in credentials
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)

  // Submit form
  await page.click('button[type="submit"]')

  // Wait for successful login
  await page.waitForSelector('text=/Welcome/', { timeout: 10000 })
}

/**
 * Wait for content script to be injected
 */
export async function waitForContentScript(page: Page, timeout = 5000) {
  await page.waitForFunction(
    () => {
      // Check if ENX content script is loaded
      return (
        document.querySelector('[data-enx-loaded]') !== null ||
        document.querySelector('.enx-word') !== null
      )
    },
    { timeout }
  )
}

/**
 * Enable learning mode on current page
 * Works around Playwright's limitations with chrome.tabs.query active tab
 */
export async function enableLearningMode(page: Page, extensionId: string) {
  // Get the target page URL
  const targetUrl = page.url()

  // Open popup to execute chrome.tabs API (which is only available in extension contexts)
  const popupPage = await page.context().newPage()
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`)
  await popupPage.waitForLoadState('domcontentloaded')

  // Execute the enable logic from popup context (has chrome.tabs API access)
  const result = await popupPage.evaluate(async (url) => {
    try {
      // Find the tab with our target URL
      const tabs = await chrome.tabs.query({})
      const targetTab = tabs.find(tab => tab.url === url)

      if (!targetTab?.id) {
        return { success: false, error: `Tab not found for URL: ${url}` }
      }

      // Send enxRun message to that specific tab's content script
      const response = await chrome.tabs.sendMessage(targetTab.id, {
        action: 'enxRun'
      })

      return response
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }, targetUrl)

  await popupPage.close()

  console.log('Enable learning mode result:', result)

  if (!result || !result.success) {
    throw new Error(`Failed to enable learning mode: ${result?.error || 'Unknown error'}`)
  }

  // Wait for processing
  await page.waitForTimeout(2000)
}

/**
 * Get count of highlighted words on page
 */
export async function getHighlightedWordsCount(page: Page): Promise<number> {
  return await page.locator('.enx-word').count()
}

/**
 * Click a highlighted word and wait for translation popup
 */
export async function clickWordAndWaitForPopup(page: Page, wordIndex = 0) {
  // Close any existing popup first by pressing Escape
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200) // Wait for popup to close

  const words = page.locator('.enx-word')
  await words.nth(wordIndex).click()

  // Wait for translation popup (correct ID is enx-word-popup)
  await page.waitForSelector('#enx-word-popup', { timeout: 3000 })
}

/**
 * Clear extension storage (logout)
 */
export async function clearStorage(page: Page) {
  // Only clear if chrome.storage is available (in extension context)
  await page.evaluate(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      return chrome.storage.local.clear()
    }
    return Promise.resolve()
  })
}
