import { FIXTURE_ORIGIN, loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import { mockBackendFetch } from './helpers'

// Chrome caps an action popup at 600px tall and scrolls anything beyond it.
const POPUP_MAX_HEIGHT = 600

test.describe('Popup - layout', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('with every card on an article page, the main page fits without a scrollbar', async ({
    context,
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await mockBackendFetch(context)
    await page.goto('/article-pick.html')
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

    await expect(popup.getByTestId('learning-mode-enable')).toBeVisible({
      timeout: 15_000,
    })
    // Every card a signed-in user can see on an ordinary article page.
    await expect(
      popup.getByRole('button', { name: 'Choose article' })
    ).toBeVisible()
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

    const height = await popup.evaluate(
      () => document.getElementById('root')!.getBoundingClientRect().height
    )
    expect(height).toBeLessThanOrEqual(POPUP_MAX_HEIGHT)
  })
})
