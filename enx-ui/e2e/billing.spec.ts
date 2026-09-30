import { type Page, type Route } from '@playwright/test'
import { test, expect, loginAvailable, LOGIN_SKIP_REASON } from './fixtures'
import type { BillingMeData } from '@/types'

// Coverage for the three billing UI pages (/billing, /billing/success,
// /billing/cancel). The Stripe-facing backend (enx-api/billing/**) already has
// Go unit/integration tests; here every /api/billing/** call is stubbed with
// page.route and we assert only what the UI does with each response: renders
// status, gates the buttons, surfaces errors, and hands the browser off to
// Stripe Checkout / the billing portal.
//
// The API client is same-origin (/api/*, proxied by next.config.ts rewrites),
// so page.route stubs intercept it directly; the stubs also send permissive
// CORS headers, harmless now but kept for cross-origin runs.

const CHECKOUT_URL = 'https://checkout.stripe.test/c/pay/cs_test_123'
const PORTAL_URL = 'https://billing.stripe.test/p/session/bps_test_123'

const freeUser: BillingMeData = {
  subscription: { status: 'none', plan: '', currentPeriodEnd: 0 },
  credits: { subscriptionBalance: 0, topupBalance: 0 },
}

const activeProPlus: BillingMeData = {
  subscription: {
    status: 'active',
    plan: 'pro-plus',
    currentPeriodEnd: 1893456000,
  },
  credits: { subscriptionBalance: 1200, topupBalance: 300 },
}

const pastDue: BillingMeData = {
  subscription: {
    status: 'past_due',
    plan: 'pro',
    currentPeriodEnd: 1893456000,
  },
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
    if (
      path.endsWith('/api/billing/checkout/subscription') &&
      stubs.checkoutSubscription
    ) {
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
    return jsonResponse(route, 500, {
      error: `unstubbed billing call: ${req.method()} ${path}`,
    })
  })
}

// Fulfil the top-level navigation that window.location.href triggers, so a test
// can assert the browser actually left for Stripe.
async function stubStripeRedirects(page: Page) {
  for (const glob of [
    'https://checkout.stripe.test/**',
    'https://billing.stripe.test/**',
  ]) {
    await page.route(glob, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body><h1>Stripe stub</h1></body></html>',
      })
    )
  }
}

// Every /billing* route sits behind Clerk, so each test signs in first as the
// dev-instance test user (ADR-037); the billing API itself stays stubbed.
test.skip(!loginAvailable, LOGIN_SKIP_REASON)
test.beforeEach(async ({ signedIn }) => signedIn)

const card = (page: Page, text: string) =>
  page.locator('[data-slot="card"]').filter({ hasText: text })

test.describe('/billing', () => {
  test('free user sees "Free user", the plan tiers by default, and top-up options behind the tab', async ({
    page,
  }) => {
    await stubBilling(page, { me: () => ({ status: 200, body: freeUser }) })
    await page.goto('/billing')

    await expect(
      page.getByRole('heading', { name: 'Subscription & Credits' })
    ).toBeVisible()
    await expect(page.getByText('Free user')).toBeVisible()

    // Prices come from plans.ts and must mirror the Stripe catalog; see the
    // comment there. 'enx Max' was stale -- the card is 'Catglish Max'.
    await expect(card(page, 'Catglish Pro+')).toContainText('$9.99/mo')
    await expect(card(page, 'Catglish Max')).toContainText('$19.99/mo')
    // creditsLabel already carries its unit; the page once appended another
    // ("500 credits/mo credits per period").
    await expect(card(page, 'Catglish Pro+')).toContainText('1,500 credits/mo')
    await expect(card(page, 'Catglish Pro+')).not.toContainText(
      'credits/mo credits'
    )
    await expect(
      page.getByRole('button', { name: 'Subscribe', exact: true })
    ).toHaveCount(3)

    // The monthly-subscription tab is the default; top-ups sit behind the
    // second tab.
    await expect(
      page.getByRole('tab', { name: 'Monthly subscription' })
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('button', { name: 'Buy', exact: true })
    ).toHaveCount(0)

    await page.getByRole('tab', { name: 'One-time credits' }).click()
    await expect(
      page.getByRole('button', { name: 'Buy', exact: true })
    ).toHaveCount(3)
    await expect(
      page.getByRole('button', { name: 'Subscribe', exact: true })
    ).toHaveCount(0)

    // No billing-portal button until there is a subscription.
    await expect(
      page.getByRole('button', { name: 'Manage subscription / billing' })
    ).toHaveCount(0)
  })

  test('active subscriber sees balances, the portal button, and disabled subscribe buttons', async ({
    page,
  }) => {
    await stubBilling(page, {
      me: () => ({ status: 200, body: activeProPlus }),
    })
    await page.goto('/billing')

    await expect(page.getByText('Pro+ member')).toBeVisible()
    await expect(card(page, 'Subscription credit balance')).toContainText(
      '1200'
    )
    await expect(card(page, 'Top-up credit balance')).toContainText('300')

    await expect(
      page.getByRole('button', { name: 'Manage subscription / billing' })
    ).toBeVisible()

    const subscribeButtons = page.getByRole('button', {
      name: 'Subscribed',
      exact: true,
    })
    await expect(subscribeButtons).toHaveCount(3)
    await expect(subscribeButtons.first()).toBeDisabled()
  })

  test('past_due subscriber reaches the Stripe billing portal', async ({
    page,
  }) => {
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
    await expect(page.getByText('Subscription past due')).toBeVisible()

    await page
      .getByRole('button', { name: 'Manage subscription / billing' })
      .click()
    await page.waitForURL('https://billing.stripe.test/**')
    expect(portalRequested).toBe(true)
  })

  test('subscribing sends the chosen plan and redirects to Stripe Checkout', async ({
    page,
  }) => {
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
    await card(page, 'Catglish Pro+')
      .getByRole('button', { name: 'Subscribe', exact: true })
      .click()

    await page.waitForURL('https://checkout.stripe.test/**')
    expect(sentPlan).toEqual({ plan: 'pro-plus' })
  })

  test('buying a top-up sends the chosen tier and redirects to Stripe Checkout', async ({
    page,
  }) => {
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
    await page.getByRole('tab', { name: 'One-time credits' }).click()
    await card(page, 'Small top-up')
      .getByRole('button', { name: 'Buy', exact: true })
      .click()

    await page.waitForURL('https://checkout.stripe.test/**')
    expect(sentTier).toEqual({ tier: 'small' })
  })

  test('a failed checkout shows an error banner and re-enables the button', async ({
    page,
  }) => {
    await stubBilling(page, {
      me: () => ({ status: 200, body: freeUser }),
      checkoutSubscription: () => ({
        status: 503,
        body: { error: 'Checkout is temporarily unavailable' },
      }),
    })

    await page.goto('/billing')
    const button = card(page, 'Catglish Pro+').getByRole('button', {
      name: 'Subscribe',
      exact: true,
    })
    await button.click()

    await expect(
      page.getByText('Checkout is temporarily unavailable')
    ).toBeVisible()
    await expect(page).toHaveURL(/\/billing$/)
    await expect(button).toBeEnabled()
  })

  test('a failed billing-status load surfaces the error instead of a badge', async ({
    page,
  }) => {
    await stubBilling(page, {
      me: () => ({
        status: 500,
        body: { error: 'Billing is temporarily unavailable' },
      }),
    })

    await page.goto('/billing')
    // Scoped to <main>: the Next dev error overlay repeats the same message.
    await expect(
      page.getByRole('main').getByText('Billing is temporarily unavailable')
    ).toBeVisible()
    await expect(page.getByText('Free user')).toHaveCount(0)
  })
})

test.describe('/billing/success', () => {
  test('explains the payment is still processing and links back to /billing', async ({
    page,
  }) => {
    await page.goto('/billing/success')

    await expect(
      page.getByText('Payment submitted', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText(
        "We're processing your payment. Your account status and credit balance usually update within a few seconds."
      )
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Back to Subscription & Credits' })
    ).toHaveAttribute('href', '/billing')
  })
})

test.describe('/billing/cancel', () => {
  test('reassures no charge was made and links back to /billing', async ({
    page,
  }) => {
    await page.goto('/billing/cancel')

    await expect(page.getByText('Canceled', { exact: true })).toBeVisible()
    await expect(
      page.getByText('Checkout was canceled and you were not charged.')
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Back to Subscription & Credits' })
    ).toHaveAttribute('href', '/billing')
  })
})
