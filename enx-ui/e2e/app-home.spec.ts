import type { Locator, Page } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type { BillingMeData, StatsOverview } from '@/types'

// What jsdom cannot see on Home (/app): on a phone neither form scrolls
// sideways, and each form's main controls are on screen. The browser has no
// extension, so the new-user form is the longer, three-step one.

const EMPTY_TOTALS = {
  wordsRead: 0,
  articlesRead: 0,
  wordLookups: 0,
  newWords: 0,
  wordsMastered: 0,
  phraseLookups: 0,
  sentenceTranslations: 0,
  contextLookups: 0,
}

const overview = (vocabTotal: number): StatsOverview => ({
  today: { ...EMPTY_TOTALS, wordsRead: 1237, wordLookups: 14 },
  week: { ...EMPTY_TOTALS, wordsRead: 8400 },
  sparkline: [400, 0, 1200, 900, 0, 300, 1237],
  vocab: { total: vocabTotal, mastered: 0 },
  recent: [],
})

const billing: BillingMeData = {
  subscription: { status: 'active', plan: 'pro', currentPeriodEnd: 1893456000 },
  credits: {
    subscriptionBalance: 1000,
    topupBalance: 240,
    trialBalance: 0,
    trialExpiresAt: null,
  },
}

test.skip(!loginAvailable, LOGIN_SKIP_REASON)

test.beforeEach(async ({ signedIn }) => {
  void signedIn
})

async function openHome(page: Page, vocabTotal: number) {
  await page.route('**/api/stats/overview**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(overview(vocabTotal)),
    })
  )
  await page.route('**/api/billing/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(billing),
    })
  )
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/app')
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth
  )

async function expectWithinViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  await locator.scrollIntoViewIfNeeded()
  const box = (await locator.boundingBox())!
  const { width } = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(width)
}

test('fits the onboarding card on a phone', async ({ page }) => {
  await openHome(page, 0)

  await expect(page.getByText('0 of 3')).toBeVisible()
  await expectWithinViewport(
    page,
    page.getByRole('link', { name: 'Start with a sample article' })
  )
  expect(await noSidewaysScroll(page)).toBe(true)
})

test("fits a returning user's numbers and plan on a phone", async ({
  page,
}) => {
  await openHome(page, 312)

  await expectWithinViewport(page, page.getByRole('link', { name: /Today/ }))
  await expectWithinViewport(page, page.getByRole('link', { name: /credits/ }))
  expect(await noSidewaysScroll(page)).toBe(true)
})
