import { BrowserContext, Page } from '@playwright/test'

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
 * Seed extension storage with a logged-in Cognito session (E2E helper).
 * Avoids interactive Hosted UI OAuth during Playwright runs.
 */
export async function seedLoggedInState(
  page: Page,
  user: {
    id?: number
    username?: string
    email?: string
    accessToken?: string
  } = {}
) {
  const userData = {
    id: user.id ?? 1,
    username: user.username ?? 'test-user',
    email: user.email ?? 'test@example.com',
    status: 'active',
    isLoggedIn: true,
  }
  const accessToken = user.accessToken ?? 'test-access-token'

  await page.evaluate(
    ({ userData, accessToken }) => {
      return chrome.storage.local.set({
        user: userData,
        'enx-user': userData,
        accessToken,
        refreshToken: 'test-refresh-token',
      })
    },
    { userData, accessToken }
  )
}

/**
 * @deprecated Legacy username/password login removed after Cognito migration.
 * Use seedLoggedInState() for E2E tests.
 */
export async function login(
  page: Page,
  username: string = 'test-user',
  _password?: string
) {
  await seedLoggedInState(page, { username })
  await page.reload({ waitUntil: 'domcontentloaded' })
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

// TODO(ADR-011 issue #11): these helpers and the specs that use them are
// still written for the removed `<u class="enx-word">` elements. After the
// switch to the CSS Custom Highlight API there are no marker elements:
// highlight count comes from CSS.highlights range totals, and a lookup is a
// coordinate click on the word text. Needs a rewrite + a homelab E2E run;
// the jest suite covers the switch in the meantime
// (src/lib/__tests__/highlightRanges.test.ts).

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
 * Stub the extension's backend API calls so tests don't depend on a real
 * enx-api backend or a valid Cognito session.
 *
 * background.ts's message handlers call `fetch()` directly inside the
 * service worker. MV3 content scripts run in an isolated world, so a
 * page-level `page.addInitScript` patch to `chrome.runtime.sendMessage`
 * never reaches it (separate JS realm); `context.route()` doesn't intercept
 * service-worker fetches either. Patching `self.fetch` inside the service
 * worker itself via `Worker.evaluate()` is what actually works.
 */
export async function mockBackendFetch(
  context: BrowserContext,
  options: {
    wordData?: Partial<{
      Key: string
      English: string
      Pronunciation: string
      Chinese: string
      LoadCount: number
      AlreadyAcquainted: number
      WordType: number
    }>
    translateFails?: boolean
    translateSessionExpired?: boolean
  } = {}
) {
  let [sw] = context.serviceWorkers()
  if (!sw) sw = await context.waitForEvent('serviceworker')

  const wordData = {
    Key: 'stub',
    English: 'stub',
    Pronunciation: '[stʌb]',
    Chinese: '存根',
    LoadCount: 1,
    AlreadyAcquainted: 0,
    WordType: 0,
    ...options.wordData,
  }
  const translateFails = options.translateFails ?? false
  const translateSessionExpired = options.translateSessionExpired ?? false

  await sw.evaluate(({ wordData, translateFails, translateSessionExpired }) => {
    const realFetch = self.fetch.bind(self)
    self.fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : (input as Request).url ?? String(input)

      if (url.includes('/api/paragraph-init')) {
        // Mirror the real endpoint's contract (word data for every word in
        // the requested paragraph) using canned data, so whatever text is
        // actually on the test page gets highlighted -- rather than
        // hardcoding a word list that has to match the fixture's prose.
        const paragraph = new URL(url).searchParams.get('paragraph') ?? ''
        const words = paragraph.split(/[^a-zA-Z']+/).filter(Boolean)
        const body: Record<string, unknown> = {}
        for (const w of words) {
          body[w.toLowerCase()] = { ...wordData, English: w }
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.includes('/api/translate')) {
        // makeApiRequest() in background.ts treats a 401 as session expiry
        // and sets sessionExpired: true on the returned error.
        if (translateSessionExpired) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (translateFails) {
          return new Response(
            JSON.stringify({ error: 'stubbed translate failure' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          )
        }
        const requested = new URL(url).searchParams.get('word')
        return new Response(
          JSON.stringify({
            ...wordData,
            English: requested || wordData.English,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      if (url.includes('/api/mark')) {
        return new Response(
          JSON.stringify({ ...wordData, AlreadyAcquainted: 1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return realFetch(input, init)
    }
  }, { wordData, translateFails, translateSessionExpired })
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
