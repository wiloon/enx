// ADR-090: every panel of a reading tab shares one card list in
// storage.session; one page event produces one paid translate; Clear/Undo
// and tab close stay in sync across panel documents.
//
// Playwright can't drive Chrome's real side panel UI, so panels run as
// ordinary extension tabs at sidepanel.html?tabId=<page tab>.

import type { BrowserContext, Page } from '@playwright/test'
import { FIXTURE_ORIGIN, loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  clickWordAndWaitForPopup,
  enableLearningMode,
  mockBackendFetch,
  translatePosts,
  waitForContentScript,
} from './helpers'

const TEST_PAGE_PATH = '/test-page.html'

async function readingTabId(page: Page, extensionId: string): Promise<number> {
  const helper = await page.context().newPage()
  await helper.goto(`chrome-extension://${extensionId}/popup.html`)
  const tabId = await helper.evaluate(
    async url => (await chrome.tabs.query({ url }))[0].id!,
    `${FIXTURE_ORIGIN}${TEST_PAGE_PATH}`
  )
  await helper.close()
  return tabId
}

async function openPanel(
  context: BrowserContext,
  extensionId: string,
  tabId: number,
  fakeClock = false
): Promise<Page> {
  const panel = await context.newPage()
  if (fakeClock) await panel.clock.install()
  await panel.goto(
    `chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`
  )
  await panel.waitForLoadState('domcontentloaded')
  return panel
}

async function sendOneSentenceFromPage(page: Page, wordIndex = 0) {
  await clickWordAndWaitForPopup(page, wordIndex)
  await page
    .locator(
      '#enx-anchored-overlay [data-testid="word-popover-sentence-translation"]'
    )
    .click()
}

function sentenceTranslatePosts(
  posts: { url: string; body: unknown }[]
): { url: string; body: unknown }[] {
  return posts.filter(p =>
    /\/api\/translate\/sentence(-with-words)?(\?|$)/.test(p.url)
  )
}

test.describe('Side Panel shared history (ADR-090)', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('one sentence → one translate; both panels show the card', async ({
    page,
    context,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context)
    await page.goto(TEST_PAGE_PATH, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const tabId = await readingTabId(page, extensionId)
    const panelA = await openPanel(context, extensionId, tabId)
    const panelB = await openPanel(context, extensionId, tabId)

    await sendOneSentenceFromPage(page)

    await expect(panelA.getByTestId('sidepanel-chinese')).toHaveText('译文')
    await expect(panelB.getByTestId('sidepanel-chinese')).toHaveText('译文')
    await expect
      .poll(async () => sentenceTranslatePosts(await translatePosts(context)))
      .toHaveLength(1)
  })

  test('a sentence absorbs the lookup card above it → one combined translate (ADR-023 Decision 9)', async ({
    page,
    context,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, {
      wordData: { Id: 'w-stub', LoadCount: 3, Known: false },
    })
    await page.goto(TEST_PAGE_PATH, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const tabId = await readingTabId(page, extensionId)
    const panel = await openPanel(context, extensionId, tabId)

    await clickWordAndWaitForPopup(page, 0)
    const lookupCard = panel.locator('[data-testid^="sidepanel-card-"]')
    await expect(lookupCard).toHaveCount(1)
    await page
      .locator(
        '#enx-anchored-overlay [data-testid="word-popover-sentence-translation"]'
      )
      .click()

    await expect(panel.getByTestId('sidepanel-chinese')).toHaveText('译文')
    await expect(lookupCard).toHaveCount(1)
    await expect(lookupCard).toContainText('义')
    await expect
      .poll(async () => {
        const posts = await translatePosts(context)
        return posts
          .filter(p => /\/api\/translate\/sentence/.test(p.url))
          .map(p => new URL(p.url).pathname)
      })
      .toEqual(['/api/translate/sentence-with-words'])
  })

  test('panel opened after translations shows prior cards and sends no new request', async ({
    page,
    context,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context)
    await page.goto(TEST_PAGE_PATH, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const tabId = await readingTabId(page, extensionId)
    const panelA = await openPanel(context, extensionId, tabId)

    // Five translations: click highlighted words until five distinct
    // sentence cards exist (words in one sentence share a card).
    const cards = panelA.getByTestId('sidepanel-sentence')
    for (let i = 0; i < 60 && (await cards.count()) < 5; i++) {
      try {
        await sendOneSentenceFromPage(page, i)
      } catch {
        break // ran out of highlighted words
      }
      await page.waitForTimeout(300)
    }
    await expect(cards).toHaveCount(5)
    await expect(panelA.getByTestId('sidepanel-chinese')).toHaveCount(5)
    const sentPosts = sentenceTranslatePosts(await translatePosts(context))
    expect(sentPosts).toHaveLength(5)

    const panelB = await openPanel(context, extensionId, tabId)
    await expect(panelB.getByTestId('sidepanel-sentence')).toHaveCount(5)
    await expect(panelB.getByTestId('sidepanel-chinese')).toHaveCount(5)
    await page.waitForTimeout(500)
    expect(sentenceTranslatePosts(await translatePosts(context))).toHaveLength(
      5
    )
  })

  test('closing the requesting panel times out its held request in another panel without resending', async ({
    page,
    context,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context, { holdSentenceTranslation: true })
    await page.goto(TEST_PAGE_PATH, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)
    const tabId = await readingTabId(page, extensionId)
    const owner = await openPanel(context, extensionId, tabId)
    await sendOneSentenceFromPage(page)
    await expect
      .poll(async () => sentenceTranslatePosts(await translatePosts(context)))
      .toHaveLength(1)
    const other = await openPanel(context, extensionId, tabId, true)
    await expect(other.getByTestId('sidepanel-loading')).toBeVisible()
    await owner.close()
    await other.clock.fastForward(121_000)
    await expect(other.getByTestId('sidepanel-error')).toContainText(
      'Request timed out. Click Retry to try again.'
    )
    await expect(other.getByTestId('sidepanel-retry-sentence')).toBeVisible()
    expect(sentenceTranslatePosts(await translatePosts(context))).toHaveLength(
      1
    )
  })

  test('a card whose owner never answered shows error + Retry after 120 s, with no resend', async ({
    page,
    context,
    extensionId,
    signedIn: _signedIn,
  }, testInfo) => {
    await mockBackendFetch(context)
    await page.goto(TEST_PAGE_PATH, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const tabId = await readingTabId(page, extensionId)
    const seeder = await openPanel(context, extensionId, tabId)
    // A loading card the (now closed) owner sent 121 s ago.
    await seeder.evaluate(
      async ({ key, startedAt }) => {
        await chrome.storage.session.set({
          [key]: {
            entries: [
              {
                kind: 'sentence',
                id: 'seeded-sentence',
                sentence: 'Seeded sentence for the timeout check.',
                clickedWord: '',
                status: 'loading',
                chinese: '',
                errorMessage: '',
                words: [],
                token: 1,
                startedAt,
              },
            ],
            cleared: null,
            nextToken: 1,
            claimedSentenceEventIds: [],
            claimedPageWordEventIds: [],
            clearGeneration: 0,
          },
        })
      },
      {
        key: `enx-panel-history:${tabId}`,
        startedAt: Date.now() - 121_000,
      }
    )
    await seeder.close()

    const panel = await openPanel(context, extensionId, tabId)
    await expect(panel.getByTestId('sidepanel-error')).toContainText(
      'Request timed out. Click Retry to try again.'
    )
    await expect(panel.getByTestId('sidepanel-retry-sentence')).toBeVisible()
    await panel.screenshot({
      path: testInfo.outputPath('timed-out-card.png'),
    })
    await page.waitForTimeout(500)
    expect(sentenceTranslatePosts(await translatePosts(context))).toHaveLength(
      0
    )
  })

  test('Clear in one panel shows empty+Undo in the other; Undo restores both', async ({
    page,
    context,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context)
    await page.goto(TEST_PAGE_PATH, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const tabId = await readingTabId(page, extensionId)
    const panelA = await openPanel(context, extensionId, tabId)
    const panelB = await openPanel(context, extensionId, tabId)
    await sendOneSentenceFromPage(page)
    await expect(panelA.getByTestId('sidepanel-chinese')).toHaveText('译文')
    await expect(panelB.getByTestId('sidepanel-chinese')).toHaveText('译文')

    await panelA.getByTestId('sidepanel-clear-all').click()
    await expect(panelA.getByTestId('sidepanel-empty-state')).toBeVisible()
    await expect(panelA.getByTestId('sidepanel-undo-clear')).toBeVisible()
    await expect(panelB.getByTestId('sidepanel-empty-state')).toBeVisible()
    await expect(panelB.getByTestId('sidepanel-undo-clear')).toBeVisible()

    await panelB.getByTestId('sidepanel-undo-clear').click()
    await expect(panelA.getByTestId('sidepanel-chinese')).toHaveText('译文')
    await expect(panelB.getByTestId('sidepanel-chinese')).toHaveText('译文')

    const cardB = panelB.locator('[data-testid^="sidepanel-card-"]')
    await expect(cardB).toHaveCount(1)
    await panelA.locator('[data-testid^="sidepanel-remove-"]').click()
    await expect(cardB).toHaveCount(0)
  })

  test('closing the reading tab drops enx-panel-history from storage.session', async ({
    page,
    context,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context)
    await page.goto(TEST_PAGE_PATH, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const tabId = await readingTabId(page, extensionId)
    const panel = await openPanel(context, extensionId, tabId)
    await sendOneSentenceFromPage(page)
    await expect(panel.getByTestId('sidepanel-chinese')).toHaveText('译文')

    const historyKey = `enx-panel-history:${tabId}`
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent('serviceworker')
    await expect
      .poll(async () =>
        sw.evaluate(async key => {
          const all = await chrome.storage.session.get(null)
          return key in all
        }, historyKey)
      )
      .toBe(true)

    await page.close()

    await expect
      .poll(async () =>
        sw.evaluate(async key => {
          const all = await chrome.storage.session.get(null)
          return key in all
        }, historyKey)
      )
      .toBe(false)
  })
})
