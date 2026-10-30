import { readFileSync } from 'node:fs'
import { enableLearningMode } from './helpers'
import { test, expect } from './new-user'
import { loginAvailable, LOGIN_SKIP_REASON, UI_ORIGIN } from './auth'

// Independent expected grant from the checked-in product configuration, never
// the server's CREDITS_TRIAL_AMOUNT override used to prove this assertion red.
const config = readFileSync(
  new URL('../../enx-api/config.toml', import.meta.url),
  'utf8'
)
const trialSection = config.match(
  /^\[credits\.trial\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m
)?.[1]
const trialAmount = Number(trialSection?.match(/^amount\s*=\s*(\d+)\s*$/m)?.[1])
if (!Number.isSafeInteger(trialAmount) || trialAmount <= 0) {
  throw new Error(
    'Expected a positive [credits.trial] amount in enx-api/config.toml'
  )
}

test.describe('New user onboarding', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)
  test.setTimeout(90_000)
  test('first sign-in grants the configured trial credits', async ({
    page,
    newUser: _,
  }) => {
    await page.goto(`${UI_ORIGIN}/billing`)
    await expect(
      page.getByText(
        new RegExp(
          `^${trialAmount.toLocaleString('en-US')} trial credits · expires `
        )
      )
    ).toBeVisible()
  })

  test('a first sample lookup completes the guide and stays complete on later visits', async ({
    page,
    extensionId,
    newUser: _,
  }) => {
    await page.goto(`${UI_ORIGIN}/welcome?src=install`)
    await expect(
      page.getByRole('heading', { name: 'Welcome to Catglish', exact: true })
    ).toBeVisible()
    const steps = page.getByRole('listitem')
    await expect(
      steps.filter({ hasText: 'Sign in' }).getByLabel('Done')
    ).toBeVisible()
    // ADR-047: once installed, the install step disappears rather than ticks.
    await expect(
      steps.filter({ hasText: 'Add Catglish to Chrome' })
    ).toHaveCount(0)
    const pin = steps.filter({ hasText: 'Pin the Catglish icon' })
    await expect(pin).toBeVisible()
    await pin.getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(pin.getByLabel('Skipped')).toBeVisible()

    const enable = steps.filter({
      hasText:
        'Click the Catglish icon in your toolbar, then Read with Catglish',
    })
    const lookup = steps.filter({ hasText: 'Click any word in the article' })
    await expect(enable.getByLabel('To do')).toBeVisible()
    await expect(lookup.getByLabel('To do')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: "You're all set" })
    ).toHaveCount(0)

    // Same public enxRun command as the toolbar popup; Playwright cannot
    // click Chrome's toolbar. Do not fake the page's learning-mode marker.
    await enableLearningMode(page, extensionId)
    await page.bringToFront()
    await expect(enable.getByLabel('Done')).toBeVisible()
    await expect(lookup.getByLabel('To do')).toBeVisible()

    // New users have no review highlights yet. Click an ordinary word in the
    // real sample article, using a DOM Range solely to locate its screen box.
    const paragraph = page.locator('#enx-reader-article p').first()
    await paragraph.scrollIntoViewIfNeeded()
    const point = await paragraph.evaluate(element => {
      const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
        const offset = node.textContent?.indexOf('experience') ?? -1
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 'experience'.length)
        const box = range.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      }
      throw new Error('Sample article must contain the word experience')
    })
    const completedWrite = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === '/api/me/preferences' &&
        response.request().method() === 'PUT'
    )
    await page.mouse.click(point.x, point.y)
    await expect(page.getByTestId('word-popover-content')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: "You're all set" })
    ).toBeVisible({ timeout: 15_000 })

    const saved = await completedWrite
    expect(saved.status(), 'save onboarding completion').toBe(200)
    expect((await saved.json()).onboardingCompleted.effective).toBe(true)

    // Check the next read too: the lookup count alone can show a returning
    // user's done view even if saving the completion preference broke.
    const preferencesRead = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === '/api/me/preferences' &&
        response.request().method() === 'GET'
    )
    // A later normal visit stays done, and an install visit goes to /app.
    await page.goto(`${UI_ORIGIN}/welcome`)
    const preferences = await preferencesRead
    expect(preferences.status()).toBe(200)
    expect((await preferences.json()).onboardingCompleted.effective).toBe(true)
    await expect(
      page.getByRole('heading', { name: "You're all set" })
    ).toBeVisible()
    await page.goto(`${UI_ORIGIN}/welcome?src=install`)
    await expect(page).toHaveURL(`${UI_ORIGIN}/app`)
  })
})
