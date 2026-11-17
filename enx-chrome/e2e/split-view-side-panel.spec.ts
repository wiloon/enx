// ADR-089 / #945: keep the ENX side panel open across both tabs of a Chrome
// Split View. Widths are read from each view's innerWidth (the spike's
// method); the panel is opened from the real popup button so open() runs
// inside a user gesture.

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

const ENGLISH_PATH = '/test-page.html'
const PARTNER_PATH = '/test-page.html?view=partner'

async function tabIdForUrl(page: Page, extensionId: string, url: string) {
  const helper = await page.context().newPage()
  await helper.goto(`chrome-extension://${extensionId}/popup.html`)
  const tabId = await helper.evaluate(
    async target => (await chrome.tabs.query({ url: target }))[0]?.id,
    url
  )
  await helper.close()
  if (tabId === undefined) throw new Error(`no tab for ${url}`)
  return tabId
}

async function createSplit(
  context: BrowserContext,
  extensionId: string,
  tabIds: [number, number]
): Promise<number> {
  const helper = await context.newPage()
  await helper.goto(`chrome-extension://${extensionId}/popup.html`)
  // createSplit requires adjacent tabs; helper pages from earlier steps can
  // sit between the two reading tabs, so move them next to each other first.
  const splitViewId = await helper.evaluate(async ids => {
    const [ownerId, partnerId] = ids as [number, number]
    const tabs = await chrome.tabs.query({})
    const owner = tabs.find(tab => tab.id === ownerId)
    if (owner?.index === undefined) {
      throw new Error(`owner tab ${ownerId} not found`)
    }
    await chrome.tabs.move(partnerId, { index: owner.index + 1 })
    return chrome.tabs.createSplit([ownerId, partnerId])
  }, tabIds)
  await helper.close()
  return splitViewId
}

async function activateTab(
  context: BrowserContext,
  extensionId: string,
  tabId: number
) {
  const helper = await context.newPage()
  await helper.goto(`chrome-extension://${extensionId}/popup.html`)
  await helper.evaluate(id => chrome.tabs.update(id, { active: true }), tabId)
  await helper.close()
}

// Playwright cannot host Chrome's real action popup (a tabbed popup.html
// steals the active tab; a windows.create popup makes currentWindow the
// popup). Drive the same setOptions+open sequence openTabSidePanel uses,
// inside a real click gesture. The popup hook is covered by unit tests.
async function openEnxSidePanel(
  context: BrowserContext,
  extensionId: string,
  ownerTabId: number,
  partnerTabId: number
) {
  await activateTab(context, extensionId, ownerTabId)
  const helper = await context.newPage()
  await helper.goto(`chrome-extension://${extensionId}/popup.html`)
  await helper.evaluate(
    ({ ownerTabId, partnerTabId }) => {
      const button = document.createElement('button')
      button.id = 'e2e-open-enx-panel'
      button.textContent = 'e2e open'
      button.addEventListener('click', () => {
        const path = `sidepanel.html?tabId=${ownerTabId}`
        void chrome.sidePanel.setOptions({
          tabId: ownerTabId,
          path,
          enabled: true,
        })
        void chrome.sidePanel.setOptions({
          tabId: partnerTabId,
          path,
          enabled: true,
        })
        void chrome.sidePanel.open({ tabId: ownerTabId })
        void chrome.sidePanel.open({ tabId: partnerTabId })
      })
      document.body.appendChild(button)
    },
    { ownerTabId, partnerTabId }
  )
  await helper.locator('#e2e-open-enx-panel').click()
  await expect
    .poll(async () =>
      helper.evaluate(async id => {
        const opts = await chrome.sidePanel.getOptions({ tabId: id })
        return Boolean(opts.enabled && opts.path?.includes(`tabId=${id}`))
      }, ownerTabId)
    )
    .toBe(true)
  await helper.close()
}

async function closePanelOnTab(
  context: BrowserContext,
  extensionId: string,
  tabId: number
) {
  const helper = await context.newPage()
  await helper.goto(`chrome-extension://${extensionId}/popup.html`)
  await helper.evaluate(id => chrome.sidePanel.close({ tabId: id }), tabId)
  await helper.close()
}

async function sidePanelContextsForTab(
  context: BrowserContext,
  extensionId: string,
  tabId: number
) {
  const helper = await context.newPage()
  await helper.goto(`chrome-extension://${extensionId}/popup.html`)
  const count = await helper.evaluate(async id => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['SIDE_PANEL' as chrome.runtime.ContextType],
    })
    return contexts.filter(c => (c.documentUrl ?? '').includes(`tabId=${id}`))
      .length
  }, tabId)
  await helper.close()
  return count
}

async function panelTargets(context: BrowserContext, ownerId: number) {
  const cdp = await context.browser()!.newBrowserCDPSession()
  const { targetInfos } = await cdp.send('Target.getTargets')
  await cdp.detach()
  return targetInfos
    .filter(t => t.url.includes(`/sidepanel.html?tabId=${ownerId}`))
    .map(t => t.targetId)
}

async function panelContent(context: BrowserContext, targetId: string) {
  const cdp = await context.browser()!.newBrowserCDPSession()
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: false,
  })
  const result = new Promise<{
    sentence: string
    translation: string
    word: string
  }>((resolve, reject) => {
    cdp.on('Target.receivedMessageFromTarget', event => {
      if (event.sessionId !== sessionId) return
      const message = JSON.parse(event.message)
      if (message.id !== 1) return
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result.result.value)
    })
  })
  await cdp.send('Target.sendMessageToTarget', {
    sessionId,
    message: JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `({ sentence: document.querySelector('[data-testid="sidepanel-sentence"]')?.textContent ?? '', translation: document.querySelector('[data-testid="sidepanel-chinese"]')?.textContent ?? '', word: document.querySelector('[data-testid^="sidepanel-card-"]')?.textContent ?? '' })`,
        returnByValue: true,
      },
    }),
  })
  const content = await result
  await cdp.send('Target.detachFromTarget', { sessionId })
  await cdp.detach()
  return content
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

async function sendOneSentenceFromPage(page: Page, wordIndex = 0) {
  await clickWordAndWaitForPopup(page, wordIndex)
  await page
    .locator(
      '#enx-anchored-overlay [data-testid="word-popover-sentence-translation"]'
    )
    .click()
}

test.describe('Split View shared side panel (ADR-089)', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  // Real window size so Split View changes each view's innerWidth (spike method).
  test.use({ viewport: null })

  test('keeps width stable, shares cards, closes both, cleans up when tabs unsplit', async ({
    page,
    context,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context)

    // Partner view first, then English — createSplit keeps both.
    const partnerPage = await context.newPage()
    await partnerPage.goto(PARTNER_PATH, { waitUntil: 'domcontentloaded' })
    await page.goto(ENGLISH_PATH, { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    const englishTabId = await tabIdForUrl(
      page,
      extensionId,
      `${FIXTURE_ORIGIN}${ENGLISH_PATH}`
    )
    const partnerTabId = await tabIdForUrl(
      partnerPage,
      extensionId,
      `${FIXTURE_ORIGIN}${PARTNER_PATH}`
    )

    const splitViewId = await createSplit(context, extensionId, [
      englishTabId,
      partnerTabId,
    ])

    // Widths after the split but before any panel (baseline for collapse).
    await activateTab(context, extensionId, englishTabId)
    await page.waitForTimeout(300)
    const splitNoPanel = {
      english: await page.evaluate(() => window.innerWidth),
      partner: await partnerPage.evaluate(() => window.innerWidth),
    }
    // Each Split View pane is roughly half the window (spike: ~677 in 1400).
    expect(splitNoPanel.english).toBeLessThan(900)
    expect(splitNoPanel.partner).toBeLessThan(900)

    await openEnxSidePanel(context, extensionId, englishTabId, partnerTabId)
    await activateTab(context, extensionId, englishTabId)
    await expect
      .poll(async () => page.evaluate(() => window.innerWidth))
      .toBeLessThan(splitNoPanel.english)

    const panelOpen = {
      english: await page.evaluate(() => window.innerWidth),
      partner: await partnerPage.evaluate(() => window.innerWidth),
    }

    // Send the first card before the mirror view is activated.
    await sendOneSentenceFromPage(page)
    await expect
      .poll(async () => sentenceTranslatePosts(await translatePosts(context)))
      .toHaveLength(1)

    const ownerTargets = await panelTargets(context, englishTabId)

    // Switch to the partner view and back: widths must stay at panel-open.
    await activateTab(context, extensionId, partnerTabId)
    await partnerPage.waitForTimeout(300)
    expect(await partnerPage.evaluate(() => window.innerWidth)).toBe(
      panelOpen.partner
    )
    expect(await page.evaluate(() => window.innerWidth)).toBe(panelOpen.english)

    await activateTab(context, extensionId, englishTabId)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => window.innerWidth)).toBe(panelOpen.english)
    expect(await partnerPage.evaluate(() => window.innerWidth)).toBe(
      panelOpen.partner
    )

    // Cards sent while only the owner panel existed, then a new sentence
    // after the partner view was focused: one translate request per sentence.
    await activateTab(context, extensionId, partnerTabId)
    await partnerPage.waitForTimeout(500)
    // Partner panel document is created lazily on first activation; shared
    // history (ADR-090) means no second translate for the prior card.
    expect(sentenceTranslatePosts(await translatePosts(context))).toHaveLength(
      1
    )
    const mirrorTarget = (await panelTargets(context, englishTabId)).find(
      id => !ownerTargets.includes(id)
    )
    expect(mirrorTarget).toBeDefined()
    await expect
      .poll(() => panelContent(context, mirrorTarget!))
      .toMatchObject({
        sentence: expect.stringMatching(/\S/),
        translation: '译文',
        word: expect.stringMatching(/\S/),
      })

    // A new sentence from the English tab: one more translate (not one per panel).
    await activateTab(context, extensionId, englishTabId)
    for (let i = 1; i < 40; i++) {
      if (sentenceTranslatePosts(await translatePosts(context)).length >= 2) {
        break
      }
      try {
        await sendOneSentenceFromPage(page, i)
      } catch {
        break
      }
      await page.waitForTimeout(300)
    }
    await expect
      .poll(async () => sentenceTranslatePosts(await translatePosts(context)))
      .toHaveLength(2)

    // Close from the partner side: both views return to no-panel width.
    await activateTab(context, extensionId, partnerTabId)
    await closePanelOnTab(context, extensionId, partnerTabId)
    await partnerPage.waitForTimeout(500)
    expect(await partnerPage.evaluate(() => window.innerWidth)).toBe(
      splitNoPanel.partner
    )
    expect(await page.evaluate(() => window.innerWidth)).toBe(
      splitNoPanel.english
    )

    // Reopen, then separate the tabs and check the former mirror is disabled.
    await openEnxSidePanel(context, extensionId, englishTabId, partnerTabId)
    await activateTab(context, extensionId, englishTabId)
    await expect
      .poll(async () => page.evaluate(() => window.innerWidth))
      .toBe(panelOpen.english)

    const helper = await context.newPage()
    await helper.goto(`chrome-extension://${extensionId}/popup.html`)
    await helper.evaluate(id => chrome.tabs.unsplit(id), splitViewId)
    await expect
      .poll(() =>
        helper.evaluate(
          id => chrome.tabs.get(id).then(tab => tab.splitViewId),
          englishTabId
        )
      )
      .toBe(-1)
    await helper.close()
    // Separating the tabs may leave the partner at a half-pane width; the
    // acceptance check is that it no longer has an ENX side panel.
    await expect
      .poll(async () =>
        sidePanelContextsForTab(context, extensionId, partnerTabId)
      )
      .toBe(0)
    await expect
      .poll(async () => {
        const helper = await context.newPage()
        await helper.goto(`chrome-extension://${extensionId}/popup.html`)
        const enabled = await helper.evaluate(async id => {
          const opts = await chrome.sidePanel.getOptions({ tabId: id })
          return Boolean(opts.enabled)
        }, partnerTabId)
        await helper.close()
        return enabled
      })
      .toBe(false)
  })
})
