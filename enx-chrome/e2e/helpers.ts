import { BrowserContext, expect, Locator, Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Helper utilities for E2E tests
 */

// NOTE (ADR-011 issue #11 / #14): highlighting is painted with the CSS Custom
// Highlight API. There are no marker elements -- the DOM has no `.enx-word`
// nodes. A highlighted word is a Range registered in `CSS.highlights` under an
// `enx-hl-*` name; a lookup is a coordinate click on the word's on-screen box.
// Keep this in sync with WordProcessor.HIGHLIGHT_NAME_PREFIX (src/lib/wordProcessor.ts);
// the e2e specs are outside the src tsconfig so it can't be imported here.
export const HIGHLIGHT_NAME_PREFIX = 'enx-hl-'

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
 * Flip the "Highlight vocabulary while reading" preference on the options
 * page, the way a user does (ADR-011 Decision 3).
 */
export async function setHighlightPref(
  page: Page,
  extensionId: string,
  enabled: boolean
) {
  const optionsPage = await page.context().newPage()
  await openOptions(optionsPage, extensionId)
  const toggle = optionsPage.locator('[data-testid="word-highlight-toggle"]')
  await expect(toggle).toBeVisible()
  if (enabled) await toggle.check()
  else await toggle.uncheck()
  // give chrome.storage.onChanged a beat to propagate to the content script
  await optionsPage.waitForTimeout(200)
  await optionsPage.close()
}

/**
 * Wait until highlighting has actually been painted: the content script's
 * `<style data-enx-highlight-styles>` is in the head AND `CSS.highlights` holds
 * at least one non-empty `enx-hl-*` entry. The style tag alone only proves the
 * script evaluated (it is injected at load, before learning mode); the registry
 * check is what tells us `processArticleContent` finished a paint.
 *
 * `emptyReviewList`: the user's review list is empty, so there is nothing to
 * paint. enableLearningMode already waited for enxRun's success reply, which
 * comes once processing finished, so only the style tag is checked.
 */
export async function waitForContentScript(
  page: Page,
  { timeout = 10000, emptyReviewList = false } = {}
) {
  await page.waitForFunction(
    ({ prefix, emptyReviewList }) => {
      if (!document.head.querySelector('style[data-enx-highlight-styles]')) {
        return false
      }
      if (emptyReviewList) return true
      const registry = (
        CSS as unknown as { highlights?: Iterable<[string, { size: number }]> }
      ).highlights
      if (!registry) return false
      for (const [name, highlight] of registry) {
        if (name.startsWith(prefix) && highlight.size > 0) return true
      }
      return false
    },
    { prefix: HIGHLIGHT_NAME_PREFIX, emptyReviewList },
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
  const result = await popupPage.evaluate(async url => {
    try {
      // Find the tab with our target URL
      const tabs = await chrome.tabs.query({})
      const targetTab = tabs.find(tab => tab.url === url)

      if (!targetTab?.id) {
        return { success: false, error: `Tab not found for URL: ${url}` }
      }

      // Send enxRun message to that specific tab's content script. The
      // manifest injects a loader at document_end that import()s the real
      // module, so right after goto(domcontentloaded) the listener may not
      // exist yet: retry only that error, briefly.
      const deadline = Date.now() + 5000
      for (;;) {
        try {
          return await chrome.tabs.sendMessage(targetTab.id, {
            action: 'enxRun',
          })
        } catch (error) {
          const notReady = /Receiving end does not exist/.test(
            (error as Error).message
          )
          if (!notReady || Date.now() > deadline) throw error
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }, targetUrl)

  await popupPage.close()

  console.log('Enable learning mode result:', result)

  if (!result || !result.success) {
    throw new Error(
      `Failed to enable learning mode: ${result?.error || 'Unknown error'}`
    )
  }

  // Wait for processing
  await page.waitForTimeout(2000)
}

export interface HighlightedWord {
  /** The word's text (Range.toString()). */
  text: string
  /** Viewport-relative centre of the word's client rect, a click point. */
  x: number
  y: number
  width: number
  height: number
}

/**
 * Every highlighted word currently painted by the CSS Custom Highlight API, in
 * document order, each with the viewport-relative centre of its client rect.
 * Runs in the page so it can read `CSS.highlights`.
 *
 * `scrollIndexIntoView` (an index into the returned array) scrolls that one
 * word into view first *only if it is off-screen* -- so callers that click a
 * word below the fold get valid coordinates, while callers reasoning about a
 * word's on-screen position (viewport-edge anchoring) keep it where it was.
 * Every rect in the result is measured after that scroll, so they stay mutually
 * consistent.
 */
export async function getHighlightedWords(
  page: Page,
  opts: { scrollIndexIntoView?: number } = {}
): Promise<HighlightedWord[]> {
  return await page.evaluate(
    ({ prefix, scrollIndex }) => {
      const registry = (
        CSS as unknown as { highlights?: Iterable<[string, Iterable<Range>]> }
      ).highlights
      if (!registry) return []

      const ranges: Range[] = []
      for (const [name, highlight] of registry) {
        if (!name.startsWith(prefix)) continue
        for (const range of highlight) ranges.push(range)
      }
      ranges.sort((a, b) => {
        const cmp = a.compareBoundaryPoints(Range.START_TO_START, b)
        return cmp !== 0 ? cmp : a.compareBoundaryPoints(Range.END_TO_END, b)
      })

      const target = scrollIndex == null ? undefined : ranges[scrollIndex]
      if (target) {
        const r = target.getBoundingClientRect()
        const offScreen =
          r.top < 0 ||
          r.left < 0 ||
          r.bottom > window.innerHeight ||
          r.right > window.innerWidth
        if (offScreen) {
          const host =
            target.startContainer.nodeType === Node.ELEMENT_NODE
              ? (target.startContainer as Element)
              : target.startContainer.parentElement
          host?.scrollIntoView({ block: 'center', inline: 'nearest' })
        }
      }

      return ranges.map(range => {
        const rect = range.getBoundingClientRect()
        return {
          text: range.toString(),
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height,
        }
      })
    },
    { prefix: HIGHLIGHT_NAME_PREFIX, scrollIndex: opts.scrollIndexIntoView }
  )
}

/**
 * Count of highlighted words on the page: total number of ranges registered
 * across every `enx-hl-*` entry in `CSS.highlights`.
 */
export async function getHighlightedWordsCount(page: Page): Promise<number> {
  return await page.evaluate(prefix => {
    const registry = (
      CSS as unknown as { highlights?: Iterable<[string, { size: number }]> }
    ).highlights
    if (!registry) return 0
    let total = 0
    for (const [name, highlight] of registry) {
      if (name.startsWith(prefix)) total += highlight.size
    }
    return total
  }, HIGHLIGHT_NAME_PREFIX)
}

/**
 * The `enx-hl-*` highlight names currently registered in `CSS.highlights`
 * (one per review bucket that has at least one word).
 */
export async function getHighlightNames(page: Page): Promise<string[]> {
  return await page.evaluate(prefix => {
    const registry = (
      CSS as unknown as { highlights?: Iterable<[string, unknown]> }
    ).highlights
    if (!registry) return []
    const names: string[] = []
    for (const [name] of registry) {
      if (name.startsWith(prefix)) names.push(name)
    }
    return names
  }, HIGHLIGHT_NAME_PREFIX)
}

/**
 * Whether a given word (by its text, case-insensitive) is currently painted as
 * a highlight. After "Mark Known" the word's Range drops out of every bucket,
 * so this returns false.
 */
export async function isWordHighlighted(
  page: Page,
  text: string
): Promise<boolean> {
  const words = await getHighlightedWords(page)
  return words.some(w => w.text.toLowerCase() === text.toLowerCase())
}

/**
 * Click the nth highlighted word (document order) by dispatching a real mouse
 * click at the centre of its on-screen box. Scrolls the word into view first
 * if it is off-screen. Returns the word's text.
 */
export async function clickHighlightedWord(
  page: Page,
  wordIndex = 0
): Promise<string> {
  const words = await getHighlightedWords(page, {
    scrollIndexIntoView: wordIndex,
  })
  const word = words[wordIndex]
  if (!word) {
    throw new Error(
      `No highlighted word at index ${wordIndex} (have ${words.length})`
    )
  }
  await page.mouse.click(word.x, word.y)
  return word.text
}

/**
 * Clicks the first occurrence of `word` in the first paragraph matching
 * `paragraphSelector` and waits for its popover. A DOM Range locates the
 * word's screen box, so the word need not be highlighted (a user with no
 * vocabulary has no paint).
 */
export async function clickWord(
  page: Page,
  word: string,
  paragraphSelector = 'article p'
): Promise<Locator> {
  await page.bringToFront()
  const paragraph = page.locator(paragraphSelector).first()
  await paragraph.scrollIntoViewIfNeeded()
  const point = await paragraph.evaluate((element, w) => {
    const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
      const offset = node.textContent?.indexOf(w) ?? -1
      if (offset < 0) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + w.length)
      const box = range.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    throw new Error(`The article must contain the word ${w}`)
  }, word)
  await page.mouse.click(point.x, point.y)
  const popover = page.locator('#enx-anchored-overlay')
  await expect(popover.getByTestId('word-popover-content')).toBeVisible()
  return popover
}

/**
 * Click a highlighted word and wait for the translation popup.
 */
export async function clickWordAndWaitForPopup(page: Page, wordIndex = 0) {
  // Close any existing popup first by pressing Escape
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200) // Wait for popup to close

  await clickHighlightedWord(page, wordIndex)

  // Wait for translation popup (correct ID is enx-anchored-overlay). Not
  // waitForSelector: its unused ElementHandle would pin the overlay in memory.
  await page.locator('#enx-anchored-overlay').waitFor({ timeout: 3000 })
}

/**
 * Stub the extension's backend API calls so tests don't depend on a real
 * enx-api backend or a valid Clerk session.
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
      // Set it to have the lookup counted: the client then sends
      // POST /api/me/word-lookups, recorded for wordLookupPosts().
      Id: string
      Key: string
      English: string
      Pronunciation: string
      Chinese: string
      LoadCount: number
      Known: boolean
      WordType: number
    }>
    /**
     * The GET /api/me/review-words answer, as [english, queryCount] pairs
     * (ADR-069). Defaults to FIXTURE_REVIEW_WORDS, each looked up
     * wordData.LoadCount times.
     */
    reviewWords?: [string, number][]
    translateFails?: boolean
    translateUnauthorized?: boolean
    /**
     * Delay before answering GET /api/translate. Used to keep the loading
     * state on screen long enough to scroll the word off (#523).
     */
    lookupDelayMs?: number
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
    Known: false,
    WordType: 0,
    ...options.wordData,
  }
  const reviewWords =
    options.reviewWords ??
    FIXTURE_REVIEW_WORDS.map((word): [string, number] => [
      word,
      wordData.LoadCount,
    ])
  const translateFails = options.translateFails ?? false
  const translateUnauthorized = options.translateUnauthorized ?? false
  const lookupDelayMs = options.lookupDelayMs ?? 0

  await sw.evaluate(
    ({
      wordData,
      reviewWords,
      translateFails,
      translateUnauthorized,
      lookupDelayMs,
    }) => {
      const realFetch = self.fetch.bind(self)
      self.fetch = async (input, init) => {
        const url =
          typeof input === 'string'
            ? input
            : ((input as Request).url ?? String(input))

        if (url.includes('/api/me/review-words')) {
          const requests = ((
            self as unknown as Record<string, unknown>
          ).__enxReviewWordsRequests ??= []) as unknown[]
          requests.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body ?? null,
          })
          return new Response(JSON.stringify(reviewWords), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (url.includes('/api/translate')) {
          if (lookupDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, lookupDelayMs))
          }
          // Every attempt gets a 401, the force-refreshed replay included.
          // With Clerk signed in that replay carries a fresh token, so
          // makeApiRequest() in background.ts reports sessionUnverified.
          if (translateUnauthorized) {
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

        if (url.includes('/api/me/word-lookups')) {
          const posts = ((
            self as unknown as Record<string, unknown>
          ).__enxWordLookupPosts ??= []) as unknown[]
          posts.push(JSON.parse(String(init?.body ?? '{}')))
          return new Response(
            JSON.stringify({
              queryCount: wordData.LoadCount + 1,
              known: false,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }

        if (/\/api\/me\/words\/[^/]+\/known$/.test(url)) {
          return new Response(JSON.stringify({ ...wordData, Known: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return realFetch(input, init)
      }
    },
    {
      wordData,
      reviewWords,
      translateFails,
      translateUnauthorized,
      lookupDelayMs,
    }
  )
}

/**
 * The review list mockBackendFetch answers by default: words spread over
 * every paragraph of test-page.html, so highlights reach each viewport edge,
 * plus `sailor` from body-paragraphs.html.
 */
export const FIXTURE_REVIEW_WORDS = [
  'software',
  'development',
  'complex',
  'planning',
  'execution',
  'developers',
  'performance',
  'scalability',
  'maintainability',
  'applications',
  'frameworks',
  'powerful',
  'robust',
  'technologies',
  'frontend',
  'interactive',
  'interfaces',
  'testing',
  'essential',
  'quality',
  'individual',
  'integration',
  'modules',
  'workflow',
  'continuous',
  'deployment',
  'reliably',
  'automated',
  'pipelines',
  'efficiency',
  'cloud',
  'computing',
  'infrastructure',
  'automatically',
  'demand',
  'available',
  'performant',
  'sailor',
]

/**
 * The GET /api/me/review-words requests the service worker sent under
 * mockBackendFetch, in order.
 */
export async function reviewWordsRequests(
  context: BrowserContext
): Promise<{ url: string; method: string; body: unknown }[]> {
  const [sw] = context.serviceWorkers()
  return sw.evaluate(
    () =>
      ((self as unknown as Record<string, unknown>).__enxReviewWordsRequests ??
        []) as { url: string; method: string; body: unknown }[]
  )
}

/**
 * The bodies of the POST /api/me/word-lookups requests the service worker
 * sent under mockBackendFetch, in order.
 */
export async function wordLookupPosts(
  context: BrowserContext
): Promise<unknown[]> {
  const [sw] = context.serviceWorkers()
  return sw.evaluate(
    () =>
      ((self as unknown as Record<string, unknown>).__enxWordLookupPosts ??
        []) as unknown[]
  )
}

const AI_LOG = fileURLToPath(
  new URL('../test-results/servers/ai.log', import.meta.url)
)

/**
 * How many completions the fake AI provider has answered this run, optionally
 * only those for one feature (e.g. `word-definition`), read from its request
 * log. Throws rather than report 0 when the log can't be trusted: with
 * E2E_SERVER_LOGS=1 the server output bypasses the file, so any file there is
 * stale from an earlier run.
 */
export function aiCompletionCount(feature?: string): number {
  if (process.env.E2E_SERVER_LOGS === '1') {
    throw new Error(
      'aiCompletionCount reads test-results/servers/ai.log, which E2E_SERVER_LOGS=1 bypasses'
    )
  }
  if (!existsSync(AI_LOG)) {
    throw new Error(`The fake AI request log is missing: ${AI_LOG}`)
  }
  let count = 0
  for (const line of readFileSync(AI_LOG, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue
    const entry = JSON.parse(line) as { event?: string; feature?: string }
    if (entry.event !== 'completion') continue
    if (feature === undefined || entry.feature === feature) count++
  }
  return count
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
