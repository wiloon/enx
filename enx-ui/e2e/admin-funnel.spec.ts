import { type Page } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type { AdminFunnelCohort, MeData } from '@/types'

// What jsdom cannot see on the admin funnel page: the nine-column table scrolls
// inside its card instead of widening the page on a phone, in light and dark.
// What the page shows is covered by the jsdom test next to it; every /api call
// here is stubbed.

const me: MeData = {
  id: 'admin',
  name: 'Admin',
  email: 'admin@example.com',
  status: 'active',
  isAdmin: true,
  avatarUrl: '',
  createdAt: '2026-01-01T00:00:00Z',
}

const cohorts: AdminFunnelCohort[] = Array.from({ length: 12 }, (_, i) => ({
  weekStart: new Date(Date.UTC(2026, 10, 23 - 7 * i))
    .toISOString()
    .slice(0, 10),
  signedUp: i === 3 ? 0 : 120,
  firstLookup: i === 3 ? 0 : 90,
  threeLookupDays: i < 3 ? null : i === 3 ? 0 : 40,
  week2: i < 3 ? null : i === 3 ? 0 : 30,
  week4: i < 5 ? null : 12,
  firstAiCall: i === 3 ? 0 : 55,
  trialEnded: i === 3 ? 0 : 20,
  firstPayment: i === 3 ? 0 : 4,
}))

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
  await page.route('**/api/admin/funnel', (route) =>
    route.fulfill(json({ cohorts }))
  )
}

test.skip(!loginAvailable, LOGIN_SKIP_REASON)
// A real Clerk sign-in plus a cold dev-server page can pass the 30s default.
test.slow()

test.beforeEach(async ({ page, signedIn }) => {
  void signedIn
  await stubApi(page)
})

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 375]) {
    test(`does not scroll the page sideways at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/admin/funnel')
      // The app shell shows "Loading..." until clerk-js, fetched from the
      // network on every load, is ready; that alone can pass the 5s default.
      await expect(
        page.getByRole('rowheader', { name: '2026-11-23' })
      ).toBeVisible({ timeout: 15_000 })
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark'
      )
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
      expect(overflow).toBeLessThanOrEqual(0)
      // The last step is reachable by scrolling the table.
      const last = page.getByRole('columnheader', { name: 'First payment' })
      await last.scrollIntoViewIfNeeded()
      await expect(last).toBeInViewport()
      await page.screenshot({
        path: `test-results/admin-funnel-${width}-${theme}.png`,
        fullPage: true,
      })
    })
  }
}
