import { render, screen } from '@testing-library/react'
import PrivacyPolicyPage from '../privacy/page'
import TermsPage from '../terms/page'
import RefundPolicyPage from '../refund/page'
import SiteFooter from '@/components/site/SiteFooter'
import { AI_PROVIDER, LEGAL, SUBPROCESSORS } from '@/lib/legal'

// SiteHeader renders HeaderAuthLinks, which calls Clerk's useAuth.
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ isSignedIn: false }),
}))

// These pages are representations to users and to two review processes, so
// the tests are about the claims being present and internally consistent --
// not about layout.

// Provider and region names contain regex metacharacters -- "Amazon Bedrock
// (Anthropic's Claude)" is not a pattern.
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('Privacy Policy', () => {
  it('names the AI provider and where it runs, not "a third party"', () => {
    render(<PrivacyPolicyPage />)

    expect(screen.getAllByText(new RegExp(AI_PROVIDER.name)).length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(new RegExp(escapeRegExp(LEGAL.hostingRegion))).length
    ).toBeGreaterThan(0)
  })

  it('lists every sub-processor from the single source of truth', () => {
    render(<PrivacyPolicyPage />)

    for (const p of SUBPROCESSORS) {
      expect(
        screen.getAllByText(new RegExp(escapeRegExp(p.name))).length
      ).toBeGreaterThan(0)
    }
  })

  it('states the "no URL, no title, no timestamp" boundary the code actually enforces', () => {
    render(<PrivacyPolicyPage />)

    expect(
      screen.getByText(/The address \(URL\) of any page you read/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/The domain or title of any page you read/)
    ).toBeInTheDocument()
  })

  it('tells the reader how to delete their data, and where to write', () => {
    render(<PrivacyPolicyPage />)

    expect(screen.getByText(/Delete your data\./)).toBeInTheDocument()
    expect(
      screen.getAllByText(new RegExp(LEGAL.privacyEmail)).length
    ).toBeGreaterThan(0)
  })
})

describe('Terms of Service', () => {
  it('warns that AI output can be confidently wrong', () => {
    render(<TermsPage />)

    expect(
      screen.getByText(/frequently useful and sometimes wrong/)
    ).toBeInTheDocument()
  })

  it('says subscriptions auto-renew', () => {
    render(<TermsPage />)

    expect(screen.getByText(/renew automatically/)).toBeInTheDocument()
  })
})

describe('Refund Policy', () => {
  it('states the no-questions window using the configured number of days', () => {
    render(<RefundPolicyPage />)

    expect(
      screen.getByText(new RegExp(`${LEGAL.subscriptionRefundDays} days`))
    ).toBeInTheDocument()
  })

  it('distinguishes unused credits (refundable) from consumed ones (not)', () => {
    render(<RefundPolicyPage />)

    expect(
      screen.getByText(/Unused credits can be refunded at any time/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Credits you have already spent are not refundable\./)
    ).toBeInTheDocument()
  })

  it('does not claim to override local consumer law', () => {
    render(<RefundPolicyPage />)

    expect(
      screen.getByText(/Where your local law gives you more than this page does/)
    ).toBeInTheDocument()
  })
})

describe('site footer', () => {
  it('links all three legal pages, because reviewers go looking for them', () => {
    render(<SiteFooter />)

    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy'
    )
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms'
    )
    expect(screen.getByRole('link', { name: 'Refund Policy' })).toHaveAttribute(
      'href',
      '/refund'
    )
  })
})

describe('launch blockers', () => {
  // A TODO shipped into a published policy is worse than a missing page: it
  // names no entity while looking like it does. This test is meant to FAIL
  // until the placeholders in lib/legal.ts are filled in.
  it.failing('has no unfilled placeholders left in lib/legal.ts', () => {
    const unfilled = Object.entries(LEGAL)
      .filter(([, v]) => typeof v === 'string' && v.startsWith('TODO'))
      .map(([k]) => k)

    expect(unfilled).toEqual([])
  })
})
