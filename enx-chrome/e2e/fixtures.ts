import { clerk, clerkSetup } from '@clerk/testing/playwright'
import { test as base, chromium, type BrowserContext } from '@playwright/test'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { E2E_USER_EMAIL, UI_ORIGIN } from './auth'
import { seedVocabulary } from './seed'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** Set via `use` in a Playwright config (see playwright.homelab.config.ts). */
export type ExtensionOptions = {
  /** Built extension to load, relative to enx-chrome/ (ADR-037: dist-e2e). */
  extensionDir: string
  /** enx-ui origin `signedIn` signs in on; the build must sync from it. */
  uiOrigin: string
  /**
   * Whether `signedIn` gives the user the fixture vocabulary. Seeding writes
   * the local throwaway database directly, so a deployed lane turns it off.
   */
  seedsVocabulary: boolean
}

type ExtensionFixtures = ExtensionOptions & {
  context: BrowserContext
  extensionId: string
  /**
   * Depend on this to run the test with a real Clerk session that the
   * extension has synced and enx-api has accepted (ADR-037 Decision 3).
   */
  signedIn: void
}

type WorkerFixtures = {
  /** Fetches a Clerk Testing Token once per worker (bot-detection bypass). */
  clerkTesting: void
}

/**
 * Custom test fixture that loads the Chrome extension
 * Usage:
 *   import { test, expect } from './fixtures';
 *   test('my test', async ({ context, extensionId, page }) => { ... });
 */
export const test = base.extend<ExtensionFixtures, WorkerFixtures>({
  extensionDir: ['dist-e2e', { option: true }],
  uiOrigin: [UI_ORIGIN, { option: true }],
  seedsVocabulary: [true, { option: true }],

  context: async ({ extensionDir, headless }, use) => {
    const pathToExtension = path.join(__dirname, '..', extensionDir)
    if (!existsSync(path.join(pathToExtension, 'manifest.json'))) {
      throw new Error(
        `${extensionDir}/ is not built -- run \`pnpm build:e2e\` first (ADR-037)`
      )
    }

    // A fresh temporary profile per test, so chrome.storage never leaks
    // between tests. E2E_CHROMIUM_PATH reuses an already-installed Chromium
    // when this Playwright version's own build is not downloaded. It must be
    // Chromium: branded Chrome ignores --load-extension.
    //
    // `headless` comes from the config (and --headed). Headless only works
    // with full Chromium's new headless mode: channel 'chromium' keeps
    // Playwright off chromium-headless-shell, which cannot load extensions.
    const context = await chromium.launchPersistentContext('', {
      headless,
      channel: 'chromium',
      executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
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

  clerkTesting: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      // Worker-scoped rather than a setup project: it sets CLERK_TESTING_TOKEN
      // on process.env, which only reaches the worker that ran it.
      await clerkSetup()
      await use()
    },
    { scope: 'worker' },
  ],

  signedIn: async (
    { context, extensionId, uiOrigin, seedsVocabulary, clerkTesting: _ },
    use
  ) => {
    // Sign in on the website, exactly where a user would; the extension picks
    // the session up through syncHost (ADR-015).
    const site = await context.newPage()
    await site.goto(`${uiOrigin}/`)
    await clerk.signIn({ page: site, emailAddress: E2E_USER_EMAIL })

    // Done only when the extension has synced the session AND enx-api accepted
    // its JWT: validateSession is GET /api/me through the background.
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    let localUserId = ''
    await test
      .expect(async () => {
        const result = await popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: 'validateSession' })
        )
        test.expect(result?.success, JSON.stringify(result)).toBe(true)
        test.expect(result?.data?.id).toEqual(test.expect.any(String))
        localUserId = result.data.id
      })
      .toPass({ timeout: 30_000 })
    await popup.close()
    await site.close()

    // The user now exists in enx-api; give it the fixture vocabulary.
    if (seedsVocabulary) seedVocabulary(localUserId)

    await use()
  },
})

export { expect } from '@playwright/test'
