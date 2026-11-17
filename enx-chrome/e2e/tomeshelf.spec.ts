// ADR-088 / #907: tomeshelf SPA rebuild, late recognition, and badge stay on
// after an in-page document change.

import { loginAvailable, LOGIN_SKIP_REASON, FIXTURE_ORIGIN } from './auth'
import { expect, test } from './fixtures'
import {
  clickWord,
  enableLearningMode,
  getHighlightedWords,
  mockBackendFetch,
  waitForContentScript,
} from './helpers'

async function badgeText(
  page: import('@playwright/test').Page,
  extensionId: string,
  tabUrl: string
): Promise<string> {
  const popup = await page.context().newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await popup.waitForLoadState('domcontentloaded')
  const text = await popup.evaluate(async url => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find(t => t.url === url || t.url?.startsWith(url))
    if (!tab?.id) return ''
    return chrome.action.getBadgeText({ tabId: tab.id })
  }, tabUrl)
  await popup.close()
  return text
}

test.describe('tomeshelf EPUB reader (ADR-088)', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test.describe('endnote anchors', () => {
    test.beforeEach(
      async ({ context, page, extensionId, signedIn: _signedIn }) => {
        await mockBackendFetch(context, {
          wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
          reviewWords: [
            ['fox', 1],
            ['shocks', 1],
          ],
        })
        await page.goto(`${FIXTURE_ORIGIN}/tomeshelf.html`, {
          waitUntil: 'domcontentloaded',
        })
        await enableLearningMode(page, extensionId)
        await waitForContentScript(page)
      }
    )

    test('looks up a word inside an anchor without href', async ({ page }) => {
      const popover = await clickWord(page, 'people', '#endnote')
      await expect(
        popover.getByTestId('word-popover-header').locator('h3')
      ).toHaveText('people')
    })

    test('highlights a review word inside an anchor without href', async ({
      page,
    }) => {
      await expect
        .poll(async () =>
          (await getHighlightedWords(page)).map(word => word.text)
        )
        .toContain('shocks')
    })

    test('preserves navigation without lookup for an anchor with href', async ({
      page,
    }) => {
      await page.locator('#endnote-link').click()
      await expect(page).toHaveURL(`${FIXTURE_ORIGIN}/tomeshelf.html#endnote`)
      await expect(page.locator('#enx-anchored-overlay')).toHaveCount(0)
    })
  })

  test('click lookup and badge survive an in-page document change', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [
        ['fox', 1],
        ['zebra', 1],
      ],
    })
    await page.goto(`${FIXTURE_ORIGIN}/tomeshelf.html`, {
      waitUntil: 'domcontentloaded',
    })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const popover = await clickWord(page, 'fox', '#tomeshelf-content p')
    await expect(
      popover.getByTestId('word-popover-header').locator('h3')
    ).toHaveText('fox')
    await page.keyboard.press('Escape')

    await page.locator('#next-document').click()
    await expect(page.locator('#tomeshelf-content')).toContainText('zebra')
    await waitForContentScript(page)

    await clickWord(page, 'zebra', '#tomeshelf-content p')
    await expect(
      page.locator(
        '#enx-anchored-overlay [data-testid="word-popover-header"] h3'
      )
    ).toHaveText('zebra')

    await expect
      .poll(() => badgeText(page, extensionId, page.url()), { timeout: 5000 })
      .toBe('✓')
  })

  // Late meta after the content script starts (ADR-088 Decision 1). The
  // fixture origin is a required host permission, so Playwright cannot grant
  // "Always enable" via chrome.permissions.request (it returns false under
  // automation). Enable while the meta is still absent; when it appears,
  // late recognition cancels and re-enables as tomeshelf. Auto-enable + late
  // meta is covered in content-script tests (tomeshelf.test.ts).
  test('late meta after enable then survives document 2', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
      reviewWords: [
        ['fox', 1],
        ['zebra', 1],
      ],
    })

    await page.goto(`${FIXTURE_ORIGIN}/tomeshelf-late.html`, {
      waitUntil: 'domcontentloaded',
    })
    // Learning mode is on and the content script has started (its highlight
    // styles are injected) before any tomeshelf meta exists.
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page, { emptyReviewList: true })
    await expect(page.locator('meta[name="generator"]')).toHaveCount(0)

    // Late insertion, driven by the test rather than a timer.
    await page.evaluate(() => {
      const addMeta = (name: string, content: string) => {
        const meta = document.createElement('meta')
        meta.setAttribute('name', name)
        meta.setAttribute('content', content)
        document.head.appendChild(meta)
      }
      addMeta('generator', 'tomeshelf 1.0.0-e2e')
      addMeta('tomeshelf:book', 'e2e-book-late')
      addMeta('tomeshelf:restores-position', 'true')
      document.body.innerHTML = `
        <article id="tomeshelf-content" data-tomeshelf-block="1">
          <p>
            The quick brown fox jumps over the lazy dog while the patient
            reader keeps reading this first document about foxes and dogs.
          </p>
        </article>
        <button id="next-document" type="button">Next</button>`
      document
        .getElementById('next-document')!
        .addEventListener('click', () => {
          history.pushState({}, '', '/books/x/read/2')
          document.title = 'Tomeshelf fixture — document 2'
          document.getElementById('tomeshelf-content')!.innerHTML =
            '<p data-tomeshelf-block="1">A second document introduces the word zebra found only after the in-page navigation replaces the article content.</p>'
        })
    })
    await expect(page.locator('#tomeshelf-content')).toBeVisible()
    await waitForContentScript(page)

    await clickWord(page, 'fox', '#tomeshelf-content p')
    await page.keyboard.press('Escape')

    await page.locator('#next-document').click()
    await expect(page.locator('#tomeshelf-content')).toContainText('zebra')
    await waitForContentScript(page)

    await clickWord(page, 'zebra', '#tomeshelf-content p')
    await expect
      .poll(() => badgeText(page, extensionId, page.url()), { timeout: 5000 })
      .toBe('✓')
  })
})
