// NOTE (ADR-011 issue #11 / #14): highlighting is painted with the CSS Custom
// Highlight API -- there are no `.enx-word` marker elements. Counts come from
// `CSS.highlights` range totals; lookups are coordinate clicks on word text.

import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  enableLearningMode,
  getHighlightNames,
  getHighlightedWordsCount,
  waitForContentScript,
} from './helpers'

test.describe('Content Script - Word Highlighting', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  // Sign in before every test; the tests themselves drive the page.
  test.beforeEach(async ({ signedIn: _signedIn }) => {})

  test('should highlight words on test page', async ({ page, extensionId }) => {
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

  test('should register highlighted words in the CSS Highlight API', async ({
    page,
    extensionId,
  }) => {
    await page.goto('/test-page.html', {
      waitUntil: 'domcontentloaded',
    })

    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    // The CSS Highlight API registry should carry at least one `enx-hl-*`
    // bucket, and those buckets should hold ranges.
    const names = await getHighlightNames(page)
    expect(names.length).toBeGreaterThan(0)
    expect(names.every(n => n.startsWith('enx-hl-'))).toBe(true)
    expect(await getHighlightedWordsCount(page)).toBeGreaterThan(0)
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
