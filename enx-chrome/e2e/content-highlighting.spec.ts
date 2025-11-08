import { expect, test } from './fixtures'
import {
    enableLearningMode,
    getHighlightedWordsCount,
    login,
    openPopup,
    waitForContentScript,
} from './helpers'

test.describe('Content Script - Word Highlighting', () => {
  test.beforeEach(async ({ page, extensionId }) => {
    // Login first
    const popupPage = await page.context().newPage()
    await openPopup(popupPage, extensionId)
    await login(popupPage, 'wiloon', 'haCahpro')
    await popupPage.close()
  })

  test('should highlight words on test page', async ({
    page,
    extensionId,
  }) => {
    // Navigate to local test page
    await page.goto('/test-page.html', {
      waitUntil: 'domcontentloaded',
    })

    // Enable learning mode
    await enableLearningMode(page, extensionId)

    // Wait for content script to process
    await waitForContentScript(page)

    // Check that words are highlighted
    const count = await getHighlightedWordsCount(page)
    expect(count).toBeGreaterThan(0)
  })

  test('should not highlight words when learning mode is disabled', async ({
    page,
  }) => {
    await page.goto('/test-page.html', {
      waitUntil: 'domcontentloaded',
    })

    // Don't enable learning mode
    await page.waitForTimeout(2000)

    // Should not have highlighted words
    const count = await getHighlightedWordsCount(page)
    expect(count).toBe(0)
  })

  test('should add enx-word class to highlighted words', async ({
    page,
    extensionId,
  }) => {
    await page.goto('/test-page.html', {
      waitUntil: 'domcontentloaded',
    })

    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    // Check CSS class
    const firstWord = page.locator('.enx-word').first()
    await expect(firstWord).toHaveClass(/enx-word/)
  })

  test('should work on different pages', async ({ page, extensionId }) => {
    // Test on a different local page
    await page.goto('/typescript-page.html', {
      waitUntil: 'domcontentloaded',
    })

    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const count = await getHighlightedWordsCount(page)
    expect(count).toBeGreaterThan(0)
  })
})
