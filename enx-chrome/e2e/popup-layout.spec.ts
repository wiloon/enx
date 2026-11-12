import type { BrowserContext, Page } from '@playwright/test'
import { FIXTURE_ORIGIN, loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import { mockBackendFetch } from './helpers'

// Chrome caps an action popup at 600px tall and scrolls anything beyond it.
const POPUP_MAX_HEIGHT = 600

// Sends a page action to the article tab's content script, as the popup does,
// retrying while the just-loaded page's content script is not listening yet.
async function pageAction(context: BrowserContext, page: Page, action: string) {
  return context.serviceWorkers()[0].evaluate(
    async ({ url, action }) => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url)
      if (!tab?.id) throw new Error('Article tab not found')
      const deadline = Date.now() + 5000
      for (;;) {
        try {
          return await chrome.tabs.sendMessage(
            tab.id,
            { action },
            { frameId: 0 }
          )
        } catch (error) {
          if (
            !String(error).includes('Receiving end does not exist') ||
            Date.now() >= deadline
          )
            throw error
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
    },
    { url: page.url(), action }
  )
}

// The tallest article row: a choice that holds for this page only, whose
// explanation and Use automatic show under the row. A hashed class name is
// what keeps the choice from being remembered.
async function choosePageOnlyArticle(context: BrowserContext, page: Page) {
  await page.evaluate(() => {
    document.body.innerHTML =
      '<div class="css-a1b2c3">A sailor reads this article.</div><div>A fox reads another story.</div>'
  })
  expect(await pageAction(context, page, 'chooseArticle')).toMatchObject({
    success: true,
  })
  await page
    .locator('body > div:first-child')
    .hover({ position: { x: 8, y: 8 } })
  await page.mouse.down()
  await page.mouse.up()
  await expect
    .poll(() => pageAction(context, page, 'getArticleChoice'))
    .toMatchObject({ choice: { source: 'your-choice', saved: false } })
}

test.describe('Popup - layout', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  for (const scenario of ['automatic', 'page-only choice'] as const) {
    test(`with every card on an article page (${scenario}), the main page fits without a scrollbar`, async ({
      context,
      page,
      extensionId,
      signedIn: _signedIn,
    }, testInfo) => {
      await mockBackendFetch(context)
      await page.goto('/article-pick.html')
      if (scenario === 'page-only choice') {
        await choosePageOnlyArticle(context, page)
      }
      const popup = await context.newPage()
      // localhost is a required host permission, so the popup would leave out
      // "Always enable on this site" (adr-039). Show the popup the tab as an
      // ordinary site instead; the tab id, and so the page itself, stay real.
      await popup.addInitScript(fixtureOrigin => {
        const query = chrome.tabs.query.bind(chrome.tabs)
        chrome.tabs.query = (async (info: chrome.tabs.QueryInfo) =>
          (await query(info)).map(tab =>
            tab.url?.startsWith(fixtureOrigin)
              ? {
                  ...tab,
                  url: tab.url.replace(fixtureOrigin, 'https://example.org'),
                }
              : tab
          )) as typeof chrome.tabs.query
      }, FIXTURE_ORIGIN)
      await popup.setViewportSize({ width: 340, height: POPUP_MAX_HEIGHT })
      await page.bringToFront()
      await popup.goto(`chrome-extension://${extensionId}/popup.html`)

      // Every card a signed-in user can see on an ordinary article page.
      await expect(
        popup.getByRole('button', { name: 'Choose article' })
      ).toBeVisible({ timeout: 15_000 })
      if (scenario === 'page-only choice') {
        await expect(
          popup.getByRole('button', { name: 'Use automatic' })
        ).toBeVisible()
        await expect(popup.getByText(/cannot be remembered/)).toBeVisible()
      }
      await expect(
        popup.getByTestId('popup-auto-enable-site-toggle')
      ).toBeAttached()
      await expect(
        popup.getByTestId('popup-word-highlight-toggle')
      ).toBeAttached()
      await expect(popup.getByTestId('popup-open-sentence-panel')).toBeVisible()
      await expect(popup.getByTestId('save-link-card')).toBeVisible()
      await expect(
        popup.getByRole('button', { name: 'Send feedback' })
      ).toBeVisible()

      const version = popup.getByRole('button', { name: /^v\d/ })
      await expect(version).toHaveCount(1)
      const geometry = await popup.evaluate(() => {
        const feedback = [...document.querySelectorAll('button')].find(
          button => button.textContent?.trim() === 'Send feedback'
        )!
        const version = [...document.querySelectorAll('button')].find(button =>
          /^v\d/.test(button.textContent ?? '')
        )!
        const versionText = document.createRange()
        versionText.selectNodeContents(version)
        const versionRect = versionText.getBoundingClientRect()
        const feedbackText = document.createRange()
        feedbackText.selectNode(feedback.lastChild!)
        const feedbackRect = feedbackText.getBoundingClientRect()
        const card = document
          .querySelector('[data-testid="save-link-card"]')!
          .getBoundingClientRect()
        const row = feedback.parentElement!.getBoundingClientRect()
        const root = document.getElementById('root')!.getBoundingClientRect()
        const lineLeft = feedback.getBoundingClientRect().left
        const lineRight = version.getBoundingClientRect().right
        return {
          lineCentreDifference: Math.abs(
            (lineLeft + lineRight) / 2 - (root.left + root.width / 2)
          ),
          feedbackIsLeft: feedbackRect.right < versionRect.left,
          hasIcon: feedback.querySelector('svg') !== null,
          centreDifference: Math.abs(
            feedbackRect.y +
              feedbackRect.height / 2 -
              versionRect.y -
              versionRect.height / 2
          ),
          cardGap: row.top - card.bottom,
          bottomGap: root.bottom - row.bottom,
          scrolls:
            document.documentElement.scrollHeight > window.innerHeight ||
            document.documentElement.scrollWidth > window.innerWidth,
        }
      })
      expect(geometry.centreDifference).toBeLessThanOrEqual(1)
      expect(geometry.lineCentreDifference).toBeLessThanOrEqual(2)
      expect(geometry.feedbackIsLeft).toBe(true)
      expect(geometry.hasIcon).toBe(false)
      expect(geometry.cardGap).toBeGreaterThanOrEqual(3)
      expect(geometry.cardGap).toBeLessThanOrEqual(5)
      expect(geometry.bottomGap).toBeGreaterThanOrEqual(7)
      expect(geometry.bottomGap).toBeLessThanOrEqual(12)
      expect(geometry.scrolls).toBe(false)

      const height = await popup.evaluate(
        () => document.getElementById('root')!.getBoundingClientRect().height
      )
      const screenshotPath = `test-results/popup-layout-${scenario.replace(/\W+/g, '-')}.png`
      await popup.screenshot({ path: screenshotPath })
      await testInfo.attach(`popup-${scenario}`, {
        path: screenshotPath,
        contentType: 'image/png',
      })
      expect(height).toBeLessThanOrEqual(POPUP_MAX_HEIGHT)
      await version.hover()
      await expect(version).toHaveAttribute(
        'title',
        /Catglish v[\s\S]*Click to copy/
      )
      await version.click()
      await expect(
        popup.getByRole('button', { name: 'Copied', exact: true })
      ).toBeVisible()
      await popup.getByRole('button', { name: 'Send feedback' }).click()
      await expect(
        popup.getByRole('textbox', { name: 'Your feedback' })
      ).toBeVisible()
      await expect(
        popup.getByRole('button', { name: /^v\d|^Copied$/ })
      ).toHaveCount(0)
    })
  }
})

test('signed-out popup keeps the standalone version footer', async ({
  context,
  extensionId,
}, testInfo) => {
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 340, height: POPUP_MAX_HEIGHT })
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await expect(
    popup.getByRole('button', { name: 'Sign in on the website' })
  ).toBeVisible()
  await expect(popup.getByRole('button', { name: /^v\d/ })).toHaveCount(1)
  await expect(
    popup.getByRole('button', { name: 'Send feedback' })
  ).toHaveCount(0)
  await popup.screenshot({ path: 'test-results/popup-layout-signed-out.png' })
  await testInfo.attach('popup-signed-out', {
    path: 'test-results/popup-layout-signed-out.png',
    contentType: 'image/png',
  })
})
