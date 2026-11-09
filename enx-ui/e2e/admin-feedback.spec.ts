import { type Page } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type { AdminFeedback, AdminFeedbackPage, MeData } from '@/types'

// What jsdom cannot see on the feedback queue (ADR-076): the wide table
// scrolls inside its card instead of widening the page on a phone, and the
// filters stay usable there. Behaviour is covered by the jsdom tests next to
// the page; every /api call here is stubbed.

const me: MeData = {
  id: 'admin',
  name: 'Admin',
  email: 'admin@example.com',
  status: 'active',
  isAdmin: true,
  avatarUrl: '',
  createdAt: '2026-01-01T00:00:00Z',
}

const LONG_URL =
  'https://www.example-news-site-with-a-long-name.com/2026/11/09/an-article-slug-that-goes-on-and-on-for-layout'

const feedback: AdminFeedback[] = [
  {
    id: 'f2',
    userId: 'user_2a9f0c1e7b4d4e6f8a1b2c3d4e5f6a7b',
    kind: 'page_report',
    url: LONG_URL,
    host: 'www.example-news-site-with-a-long-name.com',
    text: '',
    context: { adapter: 'generic', extVersion: '1.12.0' },
    details: { reason: 'no-article-node' },
    status: 'new',
    createdAt: Date.UTC(2026, 10, 9, 12, 0),
  },
  {
    id: 'f1',
    userId: 'u1',
    kind: 'page_report',
    url: 'https://x.com/a/status/1',
    host: 'x.com',
    text: '',
    context: { adapter: 'x', extVersion: '1.12.0' },
    details: { reason: 'no-words' },
    status: 'resolved',
    createdAt: Date.UTC(2026, 10, 8, 9, 30),
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
  const list: Omit<AdminFeedbackPage, 'success'> = {
    feedback,
    nextOffset: null,
  }
  await page.route('**/api/admin/feedback?**', (route) =>
    route.fulfill(json(list))
  )
}

test.skip(!loginAvailable, LOGIN_SKIP_REASON)

test.beforeEach(async ({ page, signedIn }) => {
  void signedIn
  await stubApi(page)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('scrolls the table inside its card, not the page', async ({ page }) => {
    await page.goto('/admin/feedback')
    await expect(page.getByText(LONG_URL)).toBeVisible()

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(0)

    const scroller = page.locator('table').locator('xpath=..')
    const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(scrollWidth).toBeGreaterThan(clientWidth)

    await page.screenshot({
      path: 'test-results/admin-feedback-phone.png',
      fullPage: true,
    })
  })

  test('keeps both filters on screen', async ({ page }) => {
    await page.goto('/admin/feedback')
    for (const label of ['Kind', 'Status']) {
      const box = await page.getByLabel(label).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(375)
    }
  })
})
