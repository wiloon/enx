import { test, expect, type Page, type Route } from '@playwright/test'
import type { BillingMeData } from '@/types'

// Coverage for the three billing UI pages (/billing, /billing/success,
// /billing/cancel). The Stripe-facing backend (enx-api/billing/**) already has
// Go unit/integration tests; here every /api/billing/** call is stubbed with
// page.route and we assert only what the UI does with each response: renders
// status, gates the buttons, surfaces errors, and hands the browser off to
// Stripe Checkout / the billing portal.
//
// playwright.config.ts points NEXT_PUBLIC_API_BASE_URL at the app's own origin;
// the stubs also send permissive CORS headers so they still work if the API
// base URL is left cross-origin.

const CHECKOUT_URL = 'https://checkout.stripe.test/c/pay/cs_test_123'
const PORTAL_URL = 'https://billing.stripe.test/p/session/bps_test_123'

const freeUser: BillingMeData = {
  subscription: { status: 'none', plan: '', currentPeriodEnd: 0 },
  credits: { subscriptionBalance: 0, topupBalance: 0 },
}

const activeProPlus: BillingMeData = {
  subscription: { status: 'active', plan: 'pro-plus', currentPeriodEnd: 1893456000 },
  credits: { subscriptionBalance: 1200, topupBalance: 300 },
}

const pastDue: BillingMeData = {
  subscription: { status: 'past_due', plan: 'pro', currentPeriodEnd: 1893456000 },
  credits: { subscriptionBalance: 0, topupBalance: 40 },
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type',
}

function jsonResponse(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

interface BillingStubs {
  me?: () => { status: number; body: unknown }
  checkoutSubscription?: (payload: unknown) => { status: number; body: unknown }
  checkoutTopup?: (payload: unknown) => { status: number; body: unknown }
  portal?: () => { status: number; body: unknown }
}

// installs a single dispatcher for every /api/billing/** request. Handlers that
// aren't provided fall through to a 500 so an unexpected call fails loudly.
async function stubBilling(page: Page, stubs: BillingStubs) {
  await page.route('**/api/billing/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS, body: '' })
    }
    const path = new URL(req.url()).pathname
    let payload: unknown
    try {
      payload = req.postData() ? req.postDataJSON() : undefined
    } catch {
      payload = undefined
    }

    if (path.endsWith('/api/billing/me') && stubs.me) {
      const { status, body } = stubs.me()
      return jsonResponse(route, status, body)
    }
    if (path.endsWith('/api/billing/checkout/subscription') && stubs.checkoutSubscription) {
      const { status, body } = stubs.checkoutSubscription(payload)
      return jsonResponse(route, status, body)
    }
    if (path.endsWith('/api/billing/checkout/topup') && stubs.checkoutTopup) {
      const { status, body } = stubs.checkoutTopup(payload)
      return jsonResponse(route, status, body)
    }
    if (path.endsWith('/api/billing/portal') && stubs.portal) {
      const { status, body } = stubs.portal()
      return jsonResponse(route, status, body)
    }
    return jsonResponse(route, 500, { error: `unstubbed billing call: ${req.method()} ${path}` })
  })
}

// Fulfil the top-level navigation that window.location.href triggers, so a test
// can assert the browser actually left for Stripe.
async function stubStripeRedirects(page: Page) {
  for (const glob of ['https://checkout.stripe.test/**', 'https://billing.stripe.test/**']) {
    await page.route(glob, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body><h1>Stripe stub</h1></body></html>',
      })
    )
  }
}

const card = (page: Page, text: string) =>
  page.locator('[data-slot="card"]').filter({ hasText: text })

test.describe('/billing', () => {
  test('free user sees "免费用户", the plan tiers, and top-up options', async ({ page }) => {
    await stubBilling(page, { me: () => ({ status: 200, body: freeUser }) })
    await page.goto('/billing')

    await expect(page.getByRole('heading', { name: '订阅与积分' })).toBeVisible()
    await expect(page.getByText('免费用户')).toBeVisible()

    await expect(card(page, 'enx Pro+')).toContainText('$10/mo')
    await expect(card(page, 'enx Max')).toContainText('$20/mo')
    await expect(page.getByRole('button', { name: '订阅', exact: true })).toHaveCount(3)

    await expect(page.getByRole('heading', { name: '购买 AI 翻译积分' })).toBeVisible()
    await expect(page.getByRole('button', { name: '购买', exact: true })).toHaveCount(3)

    // No billing-portal button until there is a subscription.
    await expect(page.getByRole('button', { name: '管理订阅 / 账单' })).toHaveCount(0)
  })

  test('active subscriber sees balances, the portal button, and disabled subscribe buttons', async ({
    page,
  }) => {
    await stubBilling(page, { me: () => ({ status: 200, body: activeProPlus }) })
    await page.goto('/billing')

    await expect(page.getByText('Pro+ 会员')).toBeVisible()
    await expect(card(page, '订阅积分余额')).toContainText('1200')
    await expect(card(page, '充值积分余额')).toContainText('300')

    await expect(page.getByRole('button', { name: '管理订阅 / 账单' })).toBeVisible()

    const subscribeButtons = page.getByRole('button', { name: '已订阅', exact: true })
    await expect(subscribeButtons).toHaveCount(3)
    await expect(subscribeButtons.first()).toBeDisabled()
  })

  test('past_due subscriber reaches the Stripe billing portal', async ({ page }) => {
    let portalRequested = false
    await stubBilling(page, {
      me: () => ({ status: 200, body: pastDue }),
      portal: () => {
        portalRequested = true
        return { status: 200, body: { url: PORTAL_URL } }
      },
    })
    await stubStripeRedirects(page)

    await page.goto('/billing')
    await expect(page.getByText('订阅逾期')).toBeVisible()

    await page.getByRole('button', { name: '管理订阅 / 账单' }).click()
    await page.waitForURL('https://billing.stripe.test/**')
    expect(portalRequested).toBe(true)
  })

  test('subscribing sends the chosen plan and redirects to Stripe Checkout', async ({ page }) => {
    let sentPlan: unknown
    await stubBilling(page, {
      me: () => ({ status: 200, body: freeUser }),
      checkoutSubscription: (payload) => {
        sentPlan = payload
        return { status: 200, body: { url: CHECKOUT_URL } }
      },
    })
    await stubStripeRedirects(page)

    await page.goto('/billing')
    await card(page, 'enx Pro+').getByRole('button', { name: '订阅', exact: true }).click()

    await page.waitForURL('https://checkout.stripe.test/**')
    expect(sentPlan).toEqual({ plan: 'pro-plus' })
  })

  test('buying a top-up sends the chosen tier and redirects to Stripe Checkout', async ({ page }) => {
    let sentTier: unknown
    await stubBilling(page, {
      me: () => ({ status: 200, body: freeUser }),
      checkoutTopup: (payload) => {
        sentTier = payload
        return { status: 200, body: { url: CHECKOUT_URL } }
      },
    })
    await stubStripeRedirects(page)

    await page.goto('/billing')
    await card(page, '小额充值').getByRole('button', { name: '购买', exact: true }).click()

    await page.waitForURL('https://checkout.stripe.test/**')
    expect(sentTier).toEqual({ tier: 'small' })
  })

  test('a failed checkout shows an error banner and re-enables the button', async ({ page }) => {
    await stubBilling(page, {
      me: () => ({ status: 200, body: freeUser }),
      checkoutSubscription: () => ({ status: 503, body: { error: '结账服务暂时不可用' } }),
    })

    await page.goto('/billing')
    const button = card(page, 'enx Pro+').getByRole('button', { name: '订阅', exact: true })
    await button.click()

    await expect(page.getByText('结账服务暂时不可用')).toBeVisible()
    await expect(page).toHaveURL(/\/billing$/)
    await expect(button).toBeEnabled()
  })

  test('a failed billing-status load surfaces the error instead of a badge', async ({ page }) => {
    await stubBilling(page, {
      me: () => ({ status: 500, body: { error: '账单服务暂时不可用' } }),
    })

    await page.goto('/billing')
    await expect(page.getByText('账单服务暂时不可用')).toBeVisible()
    await expect(page.getByText('免费用户')).toHaveCount(0)
  })
})

test.describe('/billing/success', () => {
  test('explains the payment is still processing and links back to /billing', async ({ page }) => {
    await page.goto('/billing/success')

    await expect(page.getByText('支付已提交', { exact: true })).toBeVisible()
    await expect(
      page.getByText('我们正在处理你的付款，账户状态和积分余额通常会在几秒内更新。')
    ).toBeVisible()
    await expect(page.getByRole('link', { name: '返回订阅与积分' })).toHaveAttribute(
      'href',
      '/billing'
    )
  })
})

test.describe('/billing/cancel', () => {
  test('reassures no charge was made and links back to /billing', async ({ page }) => {
    await page.goto('/billing/cancel')

    await expect(page.getByText('已取消', { exact: true })).toBeVisible()
    await expect(page.getByText('结账已取消，没有产生任何费用。')).toBeVisible()
    await expect(page.getByRole('link', { name: '返回订阅与积分' })).toHaveAttribute(
      'href',
      '/billing'
    )
  })
})
