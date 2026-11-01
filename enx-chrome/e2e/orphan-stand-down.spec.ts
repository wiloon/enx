import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  clickHighlightedWord,
  enableLearningMode,
  getHighlightedWords,
  getHighlightedWordsCount,
  waitForContentScript,
} from './helpers'

test('an uninstalled extension stands down when the page announces a new script', async ({
  context,
  page,
  extensionId,
  signedIn: _signedIn,
}) => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
  await enableLearningMode(page, extensionId)
  await waitForContentScript(page)
  const [word] = await getHighlightedWords(page)
  expect(word).toBeDefined()

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  // Uninstall destroys the extension page before its promise can resolve.
  await popup.evaluate(() => chrome.management.uninstallSelf()).catch(() => {})

  await page.bringToFront()
  await clickHighlightedWord(page)
  const overlay = page.locator('#enx-anchored-overlay')
  await expect(
    overlay.getByText(
      'Catglish was updated. Reload this page to keep looking up words.'
    )
  ).toBeVisible()
  await expect(
    overlay.getByRole('button', { name: 'Reload page' })
  ).toBeVisible()

  await page.evaluate(() =>
    document.dispatchEvent(new Event('enx-content-script-stand-down'))
  )
  await expect(overlay).toHaveCount(0)
  await expect.poll(() => getHighlightedWordsCount(page)).toBe(0)
  await page.mouse.click(word.x, word.y)
  await expect(overlay).toHaveCount(0)
})
