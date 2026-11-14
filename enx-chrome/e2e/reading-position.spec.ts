// Reading positions for one-page books (ADR-081, ADR-082, #897): a lookup
// deep in a long page becomes the book's position; a hidden tab writes it at
// once; reopening the page offers a corner prompt that scrolls back to the
// sentence and flashes it, leaving a closed side panel closed. A changed
// page says it could not find the sentence instead of picking another one.

import type { BrowserContext, Page } from '@playwright/test'
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import { clickWord, enableLearningMode, mockBackendFetch } from './helpers'

const PAGE = '/reading-position.html'
const SENTENCE = 'The captain read chart number 150 slowly.'
const WRITE_DEBOUNCE_MS = 2000

interface StoredPosition {
  sentence: string
  occurredAt: number
  touchedAt: number
}

/** The stored position of the fixture's book, for whoever is signed in. */
async function storedPosition(
  context: BrowserContext,
  bookKey: string
): Promise<StoredPosition | null> {
  const [sw] = context.serviceWorkers()
  return sw.evaluate(async key => {
    const items = await chrome.storage.local.get(null)
    for (const [name, value] of Object.entries(items)) {
      if (!name.startsWith('readingPositions:')) continue
      const book = (
        value as {
          books: Record<
            string,
            {
              position: { sentence: string; occurredAt: number }
              touchedAt: number
            }
          >
        }
      ).books[key]
      if (book) {
        return {
          sentence: book.position.sentence,
          occurredAt: book.position.occurredAt,
          touchedAt: book.touchedAt,
        }
      }
    }
    return null
  }, bookKey)
}

async function sidePanelsOpen(context: BrowserContext): Promise<number> {
  const [sw] = context.serviceWorkers()
  return sw.evaluate(
    async () =>
      (
        await chrome.runtime.getContexts({
          contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
        })
      ).length
  )
}

/** Serves the fixture at its own address with VARIANT replaced. */
async function serveVariant(page: Page, variant: 'original' | 'rewritten') {
  await page.unroute(`**${PAGE}`)
  await page.route(`**${PAGE}`, async route => {
    const response = await route.fetch()
    const body = (await response.text()).replace(
      "const VARIANT = 'original'",
      `const VARIANT = '${variant}'`
    )
    await route.fulfill({ response, body })
  })
}

const flashedText = (page: Page) =>
  page.evaluate(() => {
    const registry = (
      CSS as unknown as { highlights: Map<string, Iterable<Range>> }
    ).highlights
    const flash = registry.get('enx-reading-position')
    return flash ? [...flash].map(range => range.toString()) : []
  })

const prompt = (page: Page) => page.getByTestId('reading-position-prompt')
const notice = (page: Page) => page.getByTestId('reading-position-notice')

/**
 * Tells the content script its tab went hidden. Headless Chromium reports
 * every tab as visible, a background tab included, so the hidden state is
 * set in the content script's own isolated world, where its listener reads
 * it, and the browser's visibilitychange event is fired there.
 */
async function hideTab(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  const worlds: { id: number; name: string; type?: string }[] = []
  cdp.on('Runtime.executionContextCreated', ({ context: world }) => {
    worlds.push({
      id: world.id,
      name: world.name,
      type: (world.auxData as { type?: string } | undefined)?.type,
    })
  })
  await cdp.send('Runtime.enable')
  const isolated = worlds.filter(world => world.type === 'isolated')
  expect(isolated.length, 'the content script world').toBeGreaterThan(0)
  for (const world of isolated) {
    await cdp.send('Runtime.evaluate', {
      contextId: world.id,
      expression: `
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      `,
    })
  }
  await cdp.detach()
}

/** Looks a word up deep in the book, then hides the tab. */
async function readDeepAndHide(context: BrowserContext, page: Page) {
  const popover = await clickWord(page, 'slowly', '#p150')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await hideTab(context, page)
}

test.describe('Reading position on a one-page book', () => {
  // ADR-037: a real Clerk session; skipped (not faked) without credentials.
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test.beforeEach(async ({ context, signedIn: _signedIn }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 1, Known: false },
      reviewWords: [],
    })
  })

  test('a lookup deep in the page is written when the tab hides, and the prompt jumps back to it', async ({
    context,
    page,
    extensionId,
  }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
    const bookKey = new URL(page.url()).href
    await enableLearningMode(page, extensionId)
    await expect(prompt(page)).toHaveCount(0)

    await readDeepAndHide(context, page)

    // Written by the hidden tab's flush, before the 2 s debounce would have.
    await expect.poll(() => storedPosition(context, bookKey)).not.toBeNull()
    const stored = (await storedPosition(context, bookKey))!
    expect(stored.sentence).toBe(SENTENCE)
    expect(stored.touchedAt - stored.occurredAt).toBeLessThan(WRITE_DEBOUNCE_MS)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await page.bringToFront()
    await expect(prompt(page)).toBeVisible()
    await expect(prompt(page)).toContainText(
      'The captain read chart number 150'
    )

    // Bottom-right corner, clear of the pin hint at the top right.
    const viewport = page.viewportSize()!
    const box = (await prompt(page).boundingBox())!
    expect(viewport.width - (box.x + box.width)).toBeLessThan(40)
    expect(viewport.height - (box.y + box.height)).toBeLessThan(40)

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page.locator('#p150')).not.toBeInViewport()
    await prompt(page)
      .getByRole('button', { name: /continue reading/i })
      .click()

    await expect(page.locator('#p150')).toBeInViewport()
    await expect.poll(() => flashedText(page)).toEqual([SENTENCE])
    await expect(prompt(page)).toHaveCount(0)
    expect(await sidePanelsOpen(context)).toBe(0)
    // The flash is brief.
    await expect.poll(() => flashedText(page), { timeout: 5000 }).toEqual([])
  })

  test('a changed page says the sentence is gone and scrolls to about where it was', async ({
    context,
    page,
    extensionId,
  }) => {
    await serveVariant(page, 'original')
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
    const bookKey = new URL(page.url()).href
    await enableLearningMode(page, extensionId)
    await readDeepAndHide(context, page)
    await expect.poll(() => storedPosition(context, bookKey)).not.toBeNull()

    await serveVariant(page, 'rewritten')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await page.bringToFront()
    await page.evaluate(() => window.scrollTo(0, 0))
    await prompt(page)
      .getByRole('button', { name: /continue reading/i })
      .click()

    await expect(notice(page)).toContainText("Couldn't find your last sentence")
    await expect(page.locator('#p150')).toBeInViewport()
    expect(await flashedText(page)).toEqual([])
    expect(await sidePanelsOpen(context)).toBe(0)
    // The old position stands: the rewritten page recorded nothing.
    expect((await storedPosition(context, bookKey))?.sentence).toBe(SENTENCE)
  })
})
