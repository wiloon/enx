import {
  loginAvailable,
  LOGIN_SKIP_REASON,
  UI_ORIGIN,
  FIXTURE_ORIGIN,
} from './auth'
import { expect, test } from './fixtures'
import {
  clickWordAndWaitForPopup,
  enableLearningMode,
  waitForContentScript,
} from './helpers'

test.describe('AI translation and trial credits', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  test('a side panel translation spends the trial credits shown on Billing', async ({
    page,
    context,
    extensionId,
    signedIn: _signedIn,
  }) => {
    const billing = await context.newPage()
    await billing.goto(`${UI_ORIGIN}/billing`)
    const trial = billing.getByText(/^\d[\d,]* trial credits · expires /)
    await expect(trial).toBeVisible()
    const before = Number(
      (await trial.innerText()).split(' ')[0].replaceAll(',', '')
    )
    expect(before).toBeGreaterThan(0)

    await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)
    await clickWordAndWaitForPopup(page, 0)
    await page
      .locator(
        '#enx-anchored-overlay [data-testid="word-popover-sentence-translation"]'
      )
      .click()
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${extensionId}/popup.html`)
    const tabId = await panel.evaluate(
      async url => (await chrome.tabs.query({ url }))[0].id!,
      `${FIXTURE_ORIGIN}/test-page.html`
    )
    await panel.goto(
      `chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`
    )
    await expect(panel.getByTestId('sidepanel-chinese')).toHaveText(
      '[fake] 这只猫在读书。'
    )

    await billing.reload()
    await expect(trial).toBeVisible()
    const after = Number(
      (await trial.innerText()).split(' ')[0].replaceAll(',', '')
    )
    expect(after).toBeLessThan(before)
  })
})
