import { render, screen, within } from '@testing-library/react'
import PricingPage from '../pricing/page'
import { pricingCtaHref } from '@/components/site/PricingCta'
import { FREE_PLAN, SUBSCRIPTION_PLANS, TOPUP_TIERS } from '@/lib/plans'

const mockUseAuth = jest.fn(() => ({ isSignedIn: false }))
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
}))

// The header's Chrome Store button asks whether the extension is installed;
// the real check resolves after render and has nothing to do with pricing.
jest.mock('@/hooks/useExtensionStatus', () => ({
  useExtensionStatus: () => 'not-installed',
}))

beforeEach(() => mockUseAuth.mockReturnValue({ isSignedIn: false }))

// The page is a representation to visitors and to Stripe's review, so the
// tests are about every advertised price coming from plans.ts -- the file
// that mirrors the Stripe catalog -- and about the page never charging.

const card = (name: string) =>
  screen
    .getAllByText(name, { selector: '[data-slot="card-title"]' })[0]
    .closest('[data-slot="card"]') as HTMLElement

describe('/pricing', () => {
  it('shows every subscription plan with its price and credits', () => {
    render(<PricingPage />)

    for (const p of SUBSCRIPTION_PLANS) {
      const c = within(card(p.name))
      expect(c.getByText(p.priceLabel)).toBeInTheDocument()
      expect(c.getByText(p.creditsLabel)).toBeInTheDocument()
    }
  })

  it('shows every top-up tier with its price and credits', () => {
    render(<PricingPage />)

    for (const t of TOPUP_TIERS) {
      const c = within(card(t.name))
      expect(c.getByText(t.priceLabel)).toBeInTheDocument()
      expect(c.getByText(t.creditsLabel)).toBeInTheDocument()
    }
  })

  it('shows the free tier, so a visitor knows what costs nothing', () => {
    render(<PricingPage />)

    const c = within(card(FREE_PLAN.name))
    expect(c.getByText(FREE_PLAN.priceLabel)).toBeInTheDocument()
    for (const f of FREE_PLAN.features) {
      expect(c.getByText(f)).toBeInTheDocument()
    }
  })

  // ADR-079: the quota counts prefetch too, so "N lookups a day" would no
  // longer match what a reader sees; the free card names a limit, no number.
  it('names the free daily lookup limit without a number', () => {
    render(<PricingPage />)

    const c = within(card(FREE_PLAN.name))
    expect(c.getByText(/daily limit/)).toBeInTheDocument()
    expect(c.queryByText(/\d+ lookups a day/)).not.toBeInTheDocument()
  })

  it('has no checkout buttons -- every call to action is a link', () => {
    render(<PricingPage />)

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
    render(<PricingPage />)

    const [subscribe] = await screen.findAllByRole('link', {
      name: 'Subscribe',
    })
    expect(subscribe).toHaveAttribute('href', pricingCtaHref(false))
  })

  it('sends a signed-in viewer straight to /billing', async () => {
    mockUseAuth.mockReturnValue({ isSignedIn: true })
    render(<PricingPage />)

    const [subscribe] = await screen.findAllByRole('link', {
      name: 'Subscribe',
    })
    expect(subscribe).toHaveAttribute('href', '/billing')
  })

  it('does not advertise annual billing, which is not offered yet', () => {
    render(<PricingPage />)

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
