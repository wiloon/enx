import { type Page } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type { BillingMeData, CreditTransaction, MeData } from '@/types'

// The user's credit history (ADR-063) through the production pages: /billing
// links to /billing/history, the timeline renders, and the All / Added /
// Used filter asks enx-api for the right direction. Every /api call is
// stubbed. Times are asserted in Los Angeles, not UTC.

test.use({ timezoneId: 'America/Los_Angeles' })

const me: MeData = {
  id: 'reader',
  name: 'Reader',
  email: 'reader@example.com',
  status: 'active',
  isAdmin: false,
  avatarUrl: '',
  createdAt: '2026-01-01T00:00:00Z',
}

const billing: BillingMeData = {
  subscription: { status: 'none', plan: '', currentPeriodEnd: 0 },
  credits: {
    subscriptionBalance: 0,
    topupBalance: 296,
    trialBalance: 0,
    trialExpiresAt: null,
  },
}

const topup: CreditTransaction = {
  createdAt: '2026-11-06T01:30:00Z',
  type: 'GRANT_TOPUP',
  feature: '',
  amount: 300,
  totalBalanceAfter: 300,
}

const spend: CreditTransaction[] = [
  {
    createdAt: '2026-11-06T03:00:00Z',
    type: 'SETTLE',
    feature: 'translate_sentence_with_word',
    amount: -2,
    totalBalanceAfter: 296,
  },
  {
    createdAt: '2026-11-06T02:00:00Z',
    type: 'SETTLE',
    feature: 'translate_sentence_with_word',
    amount: -2,
    totalBalanceAfter: 298,
  },
]

const grant: CreditTransaction = {
  createdAt: '2026-11-04T18:00:00Z',
  type: 'GRANT_ADMIN',
  feature: '',
  amount: 25,
  totalBalanceAfter: null,
  note: 'Sorry about the outage',
}

async function stubApi(page: Page, directions: string[]) {
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, ...(body as object) }),
  })
  await page.route('**/api/me', (route) => route.fulfill(json(me)))
  await page.route('**/api/version', (route) =>
    route.fulfill(json({ version: 'e2e', commit: '', build_time: '' }))
  )
  await page.route('**/api/billing/me', (route) => route.fulfill(json(billing)))
  await page.route('**/api/me/credits/transactions**', (route) => {
    const direction =
      new URL(route.request().url()).searchParams.get('direction') ?? ''
    directions.push(direction)
    const transactions =
      direction === 'in'
        ? [topup, grant]
        : direction === 'out'
          ? spend
          : [...spend, topup, grant]
    return route.fulfill(json({ transactions, next: '' }))
  })
}

test.skip(!loginAvailable, LOGIN_SKIP_REASON)

for (const width of [1280, 375]) {
  test(`at ${width}px: /billing leads to the credit history, which filters on the server`, async ({
    page,
    signedIn,
  }) => {
    void signedIn
    await page.setViewportSize({ width, height: 900 })
    const directions: string[] = []
    await stubApi(page, directions)

    await page.goto('/billing')
    await page.getByRole('link', { name: 'Credit history' }).click()
    await expect(page).toHaveURL(/\/billing\/history$/)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Credit history' })
    ).toBeVisible()

    const list = page.getByRole('list', { name: 'Credit transactions' })
    const group = list.getByRole('button', { name: /Sentence translation ×2/ })
    await expect(group).toBeVisible()
    await expect(group).toContainText('Nov 5, 2026')
    await expect(group).toContainText('-4')
    await expect(list.getByText('Credits purchased')).toBeVisible()
    await expect(list.getByText('Nov 5, 2026 · 17:30')).toBeVisible()
    await expect(
      list.getByText('Note from support: Sorry about the outage')
    ).toBeVisible()
    expect(directions).toEqual([''])

    const filters = page.getByRole('group', { name: 'Filter' })
    for (const name of ['All', 'Added', 'Used']) {
      await expect(filters.getByRole('button', { name })).toBeInViewport()
    }

    const noOverflow = async () =>
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        )
      ).toBeLessThanOrEqual(0)
    await noOverflow()

    await filters.getByRole('button', { name: 'Used' }).click()
    await expect(group).toBeVisible()
    await expect(list.getByText('Credits purchased')).toHaveCount(0)
    expect(directions.at(-1)).toBe('out')

    await filters.getByRole('button', { name: 'Added' }).click()
    await expect(list.getByText('Credits purchased')).toBeVisible()
    await expect(group).toHaveCount(0)
    expect(directions.at(-1)).toBe('in')

    await expect(list.getByText('Credits added by support')).toBeVisible()
    await noOverflow()
    await page.screenshot({
      path: `test-results/credit-history-${width}.png`,
      fullPage: true,
    })
  })
}
