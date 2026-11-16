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

async function readingTabId(
  page: Page,
  extensionId: string
): Promise<number> {
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
  tabId: number
): Promise<Page> {
  const panel = await context.newPage()
  await panel.goto(
    `chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`
  )
  await panel.waitForLoadState('domcontentloaded')
  return panel
}

async function sendOneSentenceFromPage(page: Page) {
  await clickWordAndWaitForPopup(page, 0)
  await page
    .locator(
      '#enx-anchored-overlay [data-testid="word-popover-sentence-translation"]'
    )
    .click()
}

function sentenceTranslatePosts(
  posts: { url: string; body: unknown }[]
): { url: string; body: unknown }[] {
  return posts.filter(
    p =>
      p.url.includes('/api/translate/sentence') &&
      !p.url.includes('sentence-with-word')
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
    await sendOneSentenceFromPage(page)
    await expect(panelA.getByTestId('sidepanel-chinese')).toHaveText('译文')
    const afterFirst = sentenceTranslatePosts(await translatePosts(context))
    expect(afterFirst).toHaveLength(1)

    const panelB = await openPanel(context, extensionId, tabId)
    await expect(panelB.getByTestId('sidepanel-chinese')).toHaveText('译文')
    await page.waitForTimeout(500)
    expect(sentenceTranslatePosts(await translatePosts(context))).toHaveLength(
      1
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
