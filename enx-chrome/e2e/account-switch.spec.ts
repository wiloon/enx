import { clerk } from '@clerk/testing/playwright'
import { test, expect } from './new-user'
import { loginAvailable, LOGIN_SKIP_REASON, UI_ORIGIN } from './auth'
import {
  enableLearningMode,
  getHighlightedWordsCount,
  openPopup,
  waitForContentScript,
} from './helpers'

test.describe('Account-owned review lists', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  for (const signOutFrom of ['popup', 'website'] as const) {
    test(`${signOutFrom} sign-out clears active and stopped pages before another account signs in`, async ({
      context,
      page,
      extensionId,
      signedIn: _signedIn,
      freshUsers,
    }) => {
      test.setTimeout(120_000)
      const otherAccount = await freshUsers.create()
      const stoppedPage = await context.newPage()
      await page.goto('/test-page.html?active')
      await enableLearningMode(page, extensionId)
      await waitForContentScript(page)
      await stoppedPage.goto('/test-page.html?stopped')
      await enableLearningMode(stoppedPage, extensionId)
      await waitForContentScript(stoppedPage)

      const control = await context.newPage()
      await openPopup(control, extensionId)
      const sendToPage = (url: string, action: string) =>
        control.evaluate(
          async ({ url, action }) => {
            const tab = (await chrome.tabs.query({})).find(
              tab => tab.url === url
            )
            if (!tab?.id) throw new Error('Article tab missing')
            return chrome.tabs.sendMessage(tab.id, { action })
          },
          { url, action }
        )
      await sendToPage(stoppedPage.url(), 'enxStop')

      const website = await context.newPage()
      await website.goto(UI_ORIGIN)
      await clerk.loaded({ page: website })
      if (signOutFrom === 'popup') {
        await control.getByRole('button', { name: 'Sign out' }).click()
        await expect(
          control.getByRole('button', { name: 'Sign in on the website' })
        ).toBeVisible()
      } else {
        await clerk.signOut({ page: website })
      }
      await expect.poll(() => getHighlightedWordsCount(page)).toBe(0)
      await expect
        .poll(() => sendToPage(page.url(), 'getPageInfo'))
        .toMatchObject({ isEnxEnabled: false })

      await clerk.signIn({ page: website, emailAddress: otherAccount.email })
      await expect(async () => {
        const current = await control.evaluate(() =>
          chrome.runtime.sendMessage({ type: 'validateSession' })
        )
        expect(current?.success).toBe(true)
        expect(current?.data?.email).toBe(otherAccount.email)
      }).toPass({ timeout: 30_000 })

      // Sign-in must leave both pages off. The new account has no review words.
      for (const article of [page, stoppedPage]) {
        expect(await sendToPage(article.url(), 'getPageInfo')).toMatchObject({
          isEnxEnabled: false,
        })
        await enableLearningMode(article, extensionId)
        expect(await getHighlightedWordsCount(article)).toBe(0)
      }
    })
  }
})
