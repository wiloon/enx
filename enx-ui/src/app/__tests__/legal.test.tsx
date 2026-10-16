import { render, screen } from '@testing-library/react'
import PrivacyPolicyPage from '../privacy/page'
import TermsPage from '../terms/page'
import RefundPolicyPage from '../refund/page'
import PrivacyPolicyZhPage from '../zh/privacy/page'
import TermsZhPage from '../zh/terms/page'
import RefundPolicyZhPage from '../zh/refund/page'
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

    expect(
      screen.getAllByText(new RegExp(AI_PROVIDER.name)).length
    ).toBeGreaterThan(0)
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

  // ADR-059: lookup events carry a timestamp, the one record finer than a
  // calendar day. The policy promises a ceiling (100 days), not the
  // configured retention, and must not still claim "nothing finer".
  it('discloses lookup events and their 100-day ceiling', () => {
    render(<PrivacyPolicyPage />)

    expect(
      screen.getByText(/the time and time zone of each word lookup/)
    ).toBeInTheDocument()
    expect(screen.getByText(/At most 100 days/)).toBeInTheDocument()
    expect(screen.queryByText(/nothing finer/)).toBeNull()
  })

  it('says a person runs this, not a company', () => {
    render(<PrivacyPolicyPage />)

    expect(
      screen.getByText(/There is no company and no team/)
    ).toBeInTheDocument()
    // These pages were written for a company first. A leftover corporate
    // identity for the OPERATOR would mean the change was half-applied --
    // third-party names like "Amazon Web Services, Inc." are fine and are
    // deliberately not matched here.
    expect(screen.queryByText(/有限公司|Xingyue/)).toBeNull()
  })

  it('tells the reader how to delete their data, and where to write', () => {
    render(<PrivacyPolicyPage />)

    expect(screen.getByText(/Delete your data\./)).toBeInTheDocument()
    expect(
      screen.getAllByText(new RegExp(LEGAL.privacyEmail)).length
    ).toBeGreaterThan(0)
  })

  // ADR-032 Decision 8: "Save this link" keeps the page's address and title
  // on our server (saved_pages). Without this the policy contradicts both the
  // code and the Web Store's "Web history" disclosure.
  it('discloses that a page you save keeps its address and title until you delete it', () => {
    render(<PrivacyPolicyPage />)

    expect(
      screen.getByText(/The address and title of each page you save/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/The one exception/)).not.toBeInTheDocument()
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

  // ADR-032 Decision 8: we keep a link, not the article, so a saved page
  // only reopens while the original site still serves it.
  it('says a saved page is only a link that depends on the original site', () => {
    render(<TermsPage />)
    expect(
      screen.getByText(/A page you save is kept as a link/)
    ).toBeInTheDocument()
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
      screen.getByText(
        /Where your local law gives you more than this page does/
      )
    ).toBeInTheDocument()
  })
})

describe('site footer', () => {
  it('links all three legal pages, because reviewers go looking for them', () => {
    render(<SiteFooter />)

    expect(
      screen.getByRole('link', { name: 'Privacy Policy' })
    ).toHaveAttribute('href', '/privacy')
    expect(
      screen.getByRole('link', { name: 'Terms of Service' })
    ).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Refund Policy' })).toHaveAttribute(
      'href',
      '/refund'
    )
  })
})

describe('launch blockers', () => {
  // A TODO shipped into a published policy is worse than a missing page: it
  // names no entity while looking like it does. Every placeholder in
  // lib/legal.ts must stay filled.
  it('has no unfilled placeholders left in lib/legal.ts', () => {
    const unfilled = Object.entries(LEGAL)
      .filter(([, v]) => typeof v === 'string' && v.startsWith('TODO'))
      .map(([k]) => k)

    expect(unfilled).toEqual([])
  })
})

// --- the Chinese versions (LAUNCH-CHECKLIST §6.2b) -------------------------
//
// Two hand-written translations drift. These tests do not check the wording
// -- no test can -- but they do catch the failure that actually happens:
// someone edits one language and forgets the other, and the two pages stop
// saying the same number of things.

describe('bilingual legal pages', () => {
  const pairs: [string, () => React.JSX.Element, () => React.JSX.Element][] = [
    ['privacy', PrivacyPolicyPage, PrivacyPolicyZhPage],
    ['terms', TermsPage, TermsZhPage],
    ['refund', RefundPolicyPage, RefundPolicyZhPage],
  ]

  it.each(pairs)(
    '%s has the same section count in both languages',
    (_n, En, Zh) => {
      const en = render(<En />)
      const enCount = en.container.querySelectorAll('h2').length
      en.unmount()

      const zh = render(<Zh />)
      const zhCount = zh.container.querySelectorAll('h2').length

      expect(zhCount).toBe(enCount)
    }
  )

  it.each(pairs)('%s links to the other language', (_n, En, Zh) => {
    const en = render(<En />)
    expect(screen.getByRole('link', { name: /Chinese/ })).toBeInTheDocument()
    en.unmount()

    render(<Zh />)
    expect(screen.getByRole('link', { name: /英文/ })).toBeInTheDocument()
  })

  it('says which language governs, so a drifted translation is still resolvable', () => {
    render(<TermsZhPage />)
    expect(screen.getByText(/以中文版为准/)).toBeInTheDocument()
  })

  it('marks the Chinese pages as Chinese for screen readers and search engines', () => {
    const { container } = render(<PrivacyPolicyZhPage />)
    expect(container.querySelector('main')).toHaveAttribute('lang', 'zh-Hans')
  })

  it('discloses saved pages in the Chinese privacy policy too', () => {
    render(<PrivacyPolicyZhPage />)

    expect(screen.getByText(/你保存的每个页面的网址和标题/)).toBeInTheDocument()
    expect(screen.queryByText(/唯一的例外/)).not.toBeInTheDocument()
  })

  it('discloses lookup events in the Chinese privacy policy too', () => {
    render(<PrivacyPolicyZhPage />)

    expect(screen.getByText(/每次查词的时间和时区/)).toBeInTheDocument()
    expect(
      screen.getByText(/最多保留 100 天，之后自动删除/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/没有更细的/)).toBeNull()
  })

  it('says a saved page is only a link in the Chinese terms too', () => {
    render(<TermsZhPage />)
    expect(screen.getByText(/你保存的页面只是一个链接/)).toBeInTheDocument()
  })

  it('keeps the "no company" framing in Chinese too', () => {
    render(<TermsZhPage />)
    expect(screen.getByText(/不是一家公司/)).toBeInTheDocument()
  })

  it('carries the limitation of liability as its own signposted section', () => {
    // 《民法典》496: the party supplying standard terms must draw attention
    // to the ones limiting its own liability. A clause buried mid-paragraph
    // is the thing that rule exists to catch.
    render(<TermsZhPage />)
    expect(
      screen.getByRole('heading', { name: /责任限制/ })
    ).toBeInTheDocument()
  })
})
