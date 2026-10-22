import { type Page } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type {
  AdminLedgerEntry,
  AdminUserDetail,
  AdminUserSummary,
  MeData,
} from '@/types'

// What jsdom cannot see on the admin users pages (ADR-049): a negative
// balance is actually red, the wide users table scrolls inside its card
// instead of widening the page on a phone, the 30-day bars have heights, and
// the deduct confirmation is visible. Behaviour is covered by the jsdom
// tests next to the pages; every /api call here is stubbed.

const me: MeData = {
  id: 'admin',
  name: 'Admin',
  email: 'admin@example.com',
  status: 'active',
  isAdmin: true,
  avatarUrl: '',
  createdAt: '2026-01-01T00:00:00Z',
}

function summary(over: Partial<AdminUserSummary>): AdminUserSummary {
  return {
    id: 'u1',
    email: 'reader@example.com',
    name: 'Reader',
    status: 'active',
    createdAt: '2026-10-01T08:00:00Z',
    lastLoginAt: '2026-10-15T09:30:00Z',
    plan: 'pro',
    subscriptionStatus: 'active',
    balances: {
      subscription: 400,
      topup: 100,
      trial: 0,
      trialExpiresAt: null,
      total: 500,
    },
    totals: { paid: 900, gifted: 25, trial: 100, consumed: 425, clawedBack: 0 },
    hadClawback: false,
    ...over,
  }
}

const users = [
  summary({}),
  summary({
    id: 'u2',
    email: 'a-much-longer-address-for-layout@example.com',
    plan: '',
    subscriptionStatus: '',
    balances: {
      subscription: 0,
      topup: -30,
      trial: 0,
      trialExpiresAt: null,
      total: -30,
    },
    hadClawback: true,
  }),
]

const detail: AdminUserDetail = {
  user: {
    ...users[1],
    stripeCustomerId: 'cus_123',
    stripeDashboardUrl: 'https://dashboard.stripe.com/test/customers/cus_123',
  },
  dailyLookups: Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 17 + i)).toISOString().slice(0, 10),
    count: i === 29 ? 8 : i === 27 ? 4 : 0,
  })),
  aiSpend: [{ feature: 'translate_sentence', credits: 120 }],
}

const ledger: AdminLedgerEntry[] = [
  {
    id: 't2',
    type: 'CLAWBACK',
    amount: -90,
    balanceAfter: -30,
    feature: '',
    note: '',
    createdAt: '2026-10-05T10:00:00Z',
    source: 'refund',
  },
  {
    id: 't1',
    type: 'GRANT_TOPUP',
    amount: 60,
    balanceAfter: 60,
    feature: '',
    note: '',
    createdAt: '2026-10-02T10:00:00Z',
    source: 'stripe',
  },
]

async function stubApi(page: Page) {
  const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, ...(body as object) }),
  })
  await page.route('**/api/me', (route) => route.fulfill(json(me)))
  await page.route('**/api/version', (route) =>
    route.fulfill(json({ version: 'e2e', commit: '', build_time: '' }))
  )
  await page.route('**/api/admin/users?**', (route) =>
    route.fulfill(json({ users, total: users.length }))
  )
  await page.route('**/api/admin/users/u2', (route) =>
    route.fulfill(json(detail))
  )
  await page.route('**/api/admin/users/u2/transactions**', (route) =>
    route.fulfill(json({ transactions: ledger, next: '' }))
  )
}

test.skip(!loginAvailable, LOGIN_SKIP_REASON)

test.beforeEach(async ({ page, signedIn }) => {
  void signedIn
  await stubApi(page)
})

test('paints a negative balance red on the users list', async ({ page }) => {
  await page.goto('/admin/users')
  const negative = page.getByTitle('Negative balance')
  await expect(negative).toBeVisible()
  // The theme uses oklch(); paint it on a 1×1 canvas to read it back as RGB.
  const rgb = (el: Element) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = getComputedStyle(el).color
    ctx.fillRect(0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))
  }
  const [r, g, b] = await negative.evaluate(rgb)
  const positive = await page
    .getByRole('row', { name: /reader@example\.com/ })
    .getByText('500', { exact: true })
    .evaluate(rgb)
  expect(r).toBeGreaterThan(g + 60)
  expect(r).toBeGreaterThan(b + 60)
  expect([r, g, b]).not.toEqual(positive)
  await page.screenshot({ path: 'test-results/admin-users-list.png' })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('gives the email search a usable width', async ({ page }) => {
    await page.goto('/admin/users')
    const box = await page.getByLabel('Search by email').boundingBox()
    expect(box!.width).toBeGreaterThan(200)
  })

  for (const path of ['/admin/users', '/admin/users/u2']) {
    test(`${path} does not scroll the page sideways`, async ({ page }) => {
      await page.goto(path)
      await expect(
        page.getByText('a-much-longer-address-for-layout@example.com').first()
      ).toBeVisible()
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
      expect(overflow).toBeLessThanOrEqual(0)
      await page.screenshot({
        path: `test-results/admin-users-phone${path.replaceAll('/', '-')}.png`,
        fullPage: true,
      })
    })
  }
})

test('draws the 30-day bars to scale', async ({ page }) => {
  await page.goto('/admin/users/u2')
  const peak = page.getByTitle('2026-10-16: 8 lookups')
  const half = page.getByTitle('2026-10-14: 4 lookups')
  const zero = page.getByTitle('2026-10-15: 0 lookups')
  const height = async (l: typeof peak) => (await l.boundingBox())!.height
  const [p, h, z] = [await height(peak), await height(half), await height(zero)]
  expect(p).toBeGreaterThan(80)
  expect(h / p).toBeCloseTo(0.5, 1)
  expect(z).toBeLessThanOrEqual(2)
})

test('shows the deduct confirmation and its negative-balance warning', async ({
  page,
}) => {
  await page.goto('/admin/users/u2')
  await page.getByLabel('Credits', { exact: true }).fill('10')
  await page.getByLabel('Reason', { exact: true }).fill('chargeback')
  await page.getByRole('button', { name: 'Deduct credits' }).click()

  await expect(
    page.getByText('This leaves the top-up balance at -40 credits.')
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Confirm deduction' })
  ).toBeVisible()
  await page.screenshot({
    path: 'test-results/admin-user-deduct-confirm.png',
    fullPage: true,
  })
})
