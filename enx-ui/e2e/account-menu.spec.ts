import type { Page } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type { BillingMeData, MeData, ReferralMeData } from '@/types'

// What jsdom cannot see of the account menu and /account (#211): the menu
// opens under its trigger and inside the viewport, the trigger stays on a
// phone with the name hidden, and a long email does not widen the page.
// Behaviour is covered by the jsdom tests; every /api call here is stubbed.

const me: MeData = {
  id: '0f9a7c52-3be1-4d1e-9a51-6c1f2b7d8e90',
  name: 'Alexandra Montgomery-Smith',
  email: 'alexandra.montgomery-smith.reader@example-university.edu',
  status: 'active',
  isAdmin: false,
  avatarUrl: '',
  createdAt: '2026-03-04T10:00:00Z',
}

const billing: BillingMeData = {
  subscription: { status: 'active', plan: 'pro', currentPeriodEnd: 0 },
  credits: {
    subscriptionBalance: 1000,
    topupBalance: 200,
    trialBalance: 0,
    trialExpiresAt: null,
  },
}

const referral: ReferralMeData = {
  code: 'ALEX42',
  link: 'https://catglish.app/r/ALEX42',
  invited: 2,
  paid: 1,
  pendingRewards: [],
  totalEarned: 300,
}

async function stubApi(page: Page) {
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, ...(body as object) }),
  })
  await page.route('**/api/me', (route) => route.fulfill(json(me)))
  await page.route('**/api/billing/me', (route) => route.fulfill(json(billing)))
  await page.route('**/api/referral/me', (route) =>
    route.fulfill(json(referral))
  )
  await page.route('**/api/version', (route) =>
    route.fulfill(json({ version: 'e2e', commit: '', build_time: '' }))
  )
}

test.skip(!loginAvailable, LOGIN_SKIP_REASON)

test.beforeEach(async ({ page, signedIn }) => {
  void signedIn
  await stubApi(page)
})

const trigger = (page: Page) =>
  page.getByRole('button', { name: 'Account menu' })

test('opens the menu under its trigger, inside the viewport', async ({
  page,
}) => {
  await page.goto('/app')
  await expect(trigger(page)).toContainText(me.name)
  // Measured first: an open menu hides the rest of the page from the
  // accessibility tree, trigger included.
  const t = (await trigger(page).boundingBox())!
  await trigger(page).click()

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const m = (await menu.boundingBox())!
  const viewport = page.viewportSize()!
  expect(m.y).toBeGreaterThanOrEqual(t.y + t.height)
  expect(m.x + m.width).toBeLessThanOrEqual(viewport.width)
  // Aligned to the trigger's right edge, under the top bar's corner.
  expect(Math.abs(m.x + m.width - (t.x + t.width))).toBeLessThanOrEqual(1)
})

test('sends feedback from the menu with the cleaned page URL', async ({
  page,
}) => {
  let body: Record<string, unknown> | undefined
  await page.route('**/api/feedback', (route) => {
    body = route.request().postDataJSON()
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, recorded: true }),
    })
  })
  await page.goto('/app?tab=1#top')
  await trigger(page).click()
  await page.getByRole('menuitem', { name: 'Send feedback' }).click()

  const dialog = page.getByRole('dialog', { name: 'Send feedback' })
  await expect(dialog).toBeVisible()
  const url = dialog.getByRole('textbox', { name: 'Page URL' })
  await expect(url).toHaveValue(new URL('/app', page.url()).href)
  await expect(
    dialog.getByRole('textbox', { name: 'Your feedback' })
  ).toBeFocused()

  await page.keyboard.type('The chart is empty.')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog.getByText('Thanks — feedback sent')).toBeVisible()
  expect(body).toMatchObject({
    kind: 'text',
    url: new URL('/app', page.url()).href,
    text: 'The chart is empty.',
    details: {},
  })
  expect(Object.keys(body!.context as object).sort()).toEqual([
    'appVersion',
    'browser',
  ])
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 740 } })

  test('keeps the trigger, hides the name, and fits the menu', async ({
    page,
  }) => {
    await page.goto('/app')
    await expect(trigger(page)).toBeVisible()
    await expect(trigger(page).getByText(me.name)).toBeHidden()

    await trigger(page).click()
    const m = (await page.getByRole('menu').boundingBox())!
    expect(m.x).toBeGreaterThanOrEqual(0)
    expect(m.x + m.width).toBeLessThanOrEqual(375)
    await expect(
      page.getByRole('menuitem', { name: 'Sign out' })
    ).toBeInViewport()
  })

  test('fits the feedback dialog on screen', async ({ page }) => {
    await page.goto('/app')
    await trigger(page).click()
    await page.getByRole('menuitem', { name: 'Send feedback' }).click()

    const dialog = page.getByRole('dialog', { name: 'Send feedback' })
    const d = (await dialog.boundingBox())!
    expect(d.x).toBeGreaterThanOrEqual(0)
    expect(d.x + d.width).toBeLessThanOrEqual(375)
    await expect(dialog.getByRole('button', { name: 'Send' })).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeInViewport()
  })

  test('fits a long email and ID on /account', async ({ page }) => {
    await page.goto('/account')
    await expect(page.getByText(me.id)).toBeVisible()

    for (const el of [
      page.getByText(me.email),
      page.getByText(me.id),
      page.getByRole('button', { name: 'Copy account ID' }),
    ]) {
      const box = (await el.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(375)
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
