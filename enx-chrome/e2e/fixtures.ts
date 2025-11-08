import { test as base, chromium, type BrowserContext } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type ExtensionFixtures = {
  context: BrowserContext
  extensionId: string
}

/**
 * Custom test fixture that loads the Chrome extension
 * Usage:
 *   import { test, expect } from './fixtures';
 *   test('my test', async ({ context, extensionId, page }) => { ... });
 */
export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const pathToExtension = path.join(__dirname, '../dist')

    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      viewport: { width: 1280, height: 720 },
    })

    await use(context)
    await context.close()
  },

  // eslint-disable-next-line no-empty-pattern
  extensionId: async ({ context }, use) => {
    // Wait for service worker (background script)
    let [background] = context.serviceWorkers()
    if (!background) {
      background = await context.waitForEvent('serviceworker')
    }

    const extensionUrl = background.url()
    const [, , extensionId] = extensionUrl.split('/')

    await use(extensionId)
  },
})

export { expect } from '@playwright/test'
