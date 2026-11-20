import { render, screen, within } from '@testing-library/react'
import PricingPage, { metadata } from '../pricing/page'
import { pricingCtaHref } from '@/components/site/PricingCta'
import {
  FREE_PLAN,
  freePlanFeatures,
  SUBSCRIPTION_PLANS,
  TOPUP_TIERS,
} from '@/lib/plans'

const mockUseAuth = jest.fn(() => ({ isSignedIn: false }))
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
}))

// The header's Chrome Store button asks whether the extension is installed;
// the real check resolves after render and has nothing to do with pricing.
jest.mock('@/hooks/useExtensionStatus', () => ({
  useExtensionStatus: () => 'not-installed',
}))

const originalFetch = global.fetch

function stubFreeLimitResponse(body: unknown, init: { ok?: boolean } = {}) {
  const ok = init.ok ?? true
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: async () => body,
  }) as unknown as typeof fetch
}

beforeEach(() => {
  mockUseAuth.mockReturnValue({ isSignedIn: false })
  process.env.API_BASE_URL = 'http://api.test'
  // Default: unusable body → no-number Free copy unless a test stubs otherwise.
  stubFreeLimitResponse({})
})

afterEach(() => {
  global.fetch = originalFetch
})

const card = (name: string) =>
  screen
    .getAllByText(name, { selector: '[data-slot="card-title"]' })[0]
    .closest('[data-slot="card"]') as HTMLElement

async function renderPricing() {
  render(await PricingPage())
}

describe('/pricing', () => {
  it('shows every subscription plan with its price and credits', async () => {
    await renderPricing()

    for (const p of SUBSCRIPTION_PLANS) {
      const c = within(card(p.name))
      expect(c.getByText(p.priceLabel)).toBeInTheDocument()
      expect(c.getByText(p.creditsLabel)).toBeInTheDocument()
    }
  })

  it('shows every top-up tier with its price and credits', async () => {
    await renderPricing()

    for (const t of TOPUP_TIERS) {
      const c = within(card(t.name))
      expect(c.getByText(t.priceLabel)).toBeInTheDocument()
      expect(c.getByText(t.creditsLabel)).toBeInTheDocument()
    }
  })

  it('shows the free tier, so a visitor knows what costs nothing', async () => {
    await renderPricing()

    const c = within(card(FREE_PLAN.name))
    expect(c.getByText(FREE_PLAN.priceLabel)).toBeInTheDocument()
    for (const f of freePlanFeatures(null)) {
      expect(c.getByText(f)).toBeInTheDocument()
    }
  })

  // ADR-029: Free card shows the effective free ceiling from enx-api.
  it('names the free daily lookup limit from a usable upstream value', async () => {
    stubFreeLimitResponse({ free_daily_lookup_limit: 2345 })
    await renderPricing()

    const c = within(card(FREE_PLAN.name))
    expect(c.getByText(/up to 2,345 lookups a day/i)).toBeInTheDocument()
  })

  it('falls back to the no-number Free copy when the request fails', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network')) as unknown as typeof fetch
    await renderPricing()

    const c = within(card(FREE_PLAN.name))
    expect(
      c.getByText(
        /Click any word for its dictionary meaning, with a daily limit/
      )
    ).toBeInTheDocument()
    expect(c.queryByText(/up to .+ lookups a day/i)).toBeNull()
  })

  it('falls back to the no-number Free copy when the limit is unusable', async () => {
    stubFreeLimitResponse({ free_daily_lookup_limit: 0 })
    await renderPricing()

    const c = within(card(FREE_PLAN.name))
    expect(
      c.getByText(
        /Click any word for its dictionary meaning, with a daily limit/
      )
    ).toBeInTheDocument()
  })

  it('lists what every paid plan adds without a daily lookup line', async () => {
    await renderPricing()

    for (const p of SUBSCRIPTION_PLANS) {
      const c = within(card(p.name))
      expect(c.getByText(/everything in free/i)).toBeInTheDocument()
      expect(c.queryByText(/lookups? a day/i)).toBeNull()
    }
  })

  it('describes paid plans as adding AI credits, not a higher lookup limit', () => {
    expect(metadata.description).toMatch(
      /Paid plans add monthly AI translation credits\./
    )
    expect(metadata.description).not.toMatch(/higher daily lookup limit/i)
  })

  it('says what a credit buys', async () => {
    await renderPricing()

    expect(
      screen.getByText(/charged by length, from 1 credit per request/i)
    ).toBeInTheDocument()
  })

  it('has no checkout buttons -- every call to action is a link', async () => {
    await renderPricing()

    // Scoped to <main>: the site header's mobile-menu toggle is a button but
    // starts no checkout.
    expect(
      within(screen.getByRole('main')).queryAllByRole('button')
    ).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: 'Subscribe' })).toHaveLength(
      SUBSCRIPTION_PLANS.length
    )
    expect(screen.getAllByRole('link', { name: 'Buy' })).toHaveLength(
      TOPUP_TIERS.length
    )
  })

  it('sends a signed-out visitor to sign up, then on to /billing', async () => {
    await renderPricing()

    const [subscribe] = await screen.findAllByRole('link', {
      name: 'Subscribe',
    })
    expect(subscribe).toHaveAttribute('href', pricingCtaHref(false))
  })

  it('sends a signed-in viewer straight to /billing', async () => {
    mockUseAuth.mockReturnValue({ isSignedIn: true })
    await renderPricing()

    const [subscribe] = await screen.findAllByRole('link', {
      name: 'Subscribe',
    })
    expect(subscribe).toHaveAttribute('href', '/billing')
  })

  it('does not advertise annual billing, which is not offered yet', async () => {
    await renderPricing()

    expect(screen.queryByText(/\/yr|annual|yearly/i)).toBeNull()
  })
})

describe('pricingCtaHref', () => {
  it('routes a signed-out visitor through sign-up back to /billing', () => {
    expect(pricingCtaHref(false)).toBe('/sign-up?redirect_url=%2Fbilling')
  })

  it('routes a signed-in viewer to /billing', () => {
    expect(pricingCtaHref(true)).toBe('/billing')
  })
})
