import { render, screen, within } from '@testing-library/react'
import { SITE } from '@/lib/site'
import { SUBSCRIPTION_PLANS } from '@/lib/plans'

const mockUseAuth = jest.fn(() => ({ isSignedIn: false }))
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
}))

const mockExtensionStatus = jest.fn(() => 'not-installed')
jest.mock('@/hooks/useExtensionStatus', () => ({
  useExtensionStatus: () => mockExtensionStatus(),
}))

import HeaderAuthLinks from '../HeaderAuthLinks'
import Hero from '../Hero'
import DemoVideo from '../DemoVideo'
import FeatureSection from '../FeatureSection'
import Comparison from '../Comparison'
import InstallCTA from '../InstallCTA'
import SiteFooter from '../SiteFooter'
import SiteHeader from '../SiteHeader'

jest.mock('@/lib/site', () => {
  const actual = jest.requireActual('@/lib/site')
  return { SITE: { ...actual.SITE } }
})

// `as const` in src/lib/site.ts narrows each value to a string literal; these
// tests swap in other strings, so widen to `string` as well as dropping readonly.
const mutableSite = SITE as unknown as Record<keyof typeof SITE, string>
const original = { ...SITE }
afterEach(() => {
  Object.assign(mutableSite, original)
  mockExtensionStatus.mockReturnValue('not-installed')
})

describe('HeaderAuthLinks', () => {
  beforeEach(() => mockUseAuth.mockReturnValue({ isSignedIn: false }))

  it('shows "Sign in" pointing at /app when signed out', async () => {
    render(<HeaderAuthLinks />)
    const link = await screen.findByRole('link', { name: 'Sign in' })
    expect(link).toHaveAttribute('href', '/app')
  })

  it('shows "Go to app" when Clerk reports a signed-in viewer', async () => {
    mockUseAuth.mockReturnValue({ isSignedIn: true })
    render(<HeaderAuthLinks />)
    expect(
      await screen.findByRole('link', { name: 'Go to app' })
    ).toBeInTheDocument()
  })
})

describe('Hero', () => {
  it('links the primary CTA to the Chrome Web Store', () => {
    render(<Hero />)
    const cta = screen.getByRole('link', { name: /add to chrome/i })
    expect(cta).toHaveAttribute('href', SITE.chromeWebStoreUrl)
    expect(
      screen.getByRole('link', { name: /see how it works/i })
    ).toHaveAttribute('href', '#how-it-works')
  })

  it('keeps the store CTA while extension detection is pending', () => {
    mockExtensionStatus.mockReturnValue('unknown')
    render(<Hero />)
    expect(
      screen.getByRole('link', { name: /add to chrome/i })
    ).toHaveAttribute('href', SITE.chromeWebStoreUrl)
  })

  it('swaps the store CTA for "Go to app" when the extension is installed', () => {
    mockExtensionStatus.mockReturnValue('installed')
    render(<Hero />)
    expect(
      screen.queryByRole('link', { name: /add to chrome/i })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to app' })).toHaveAttribute(
      'href',
      SITE.appPath
    )
  })

  it('quotes the cheapest plan from plans.ts and links to /pricing', () => {
    render(<Hero />)
    expect(screen.getByText(/plans from/)).toHaveTextContent(
      `plans from ${SUBSCRIPTION_PLANS[0].priceLabel}`
    )
    expect(screen.getByRole('link', { name: 'See pricing' })).toHaveAttribute(
      'href',
      '/pricing'
    )
  })
})

describe('DemoVideo', () => {
  it('renders a poster and "Demo coming soon" (no media element) when no url is set', () => {
    mutableSite.demoVideoUrl = ''
    const { container } = render(<DemoVideo />)
    expect(screen.getByText('Demo coming soon')).toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('renders a <video> with preload="none" and a poster for an mp4 url', () => {
    mutableSite.demoVideoUrl = 'https://example.com/demo.mp4'
    const { container } = render(<DemoVideo />)
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video).toHaveAttribute('preload', 'none')
    expect(video).toHaveAttribute('poster', SITE.demoPoster)
  })
})

describe('FeatureSection', () => {
  it('renders every feature title and an accessible image for each', () => {
    render(<FeatureSection />)
    expect(
      screen.getByText('Word highlight while you read')
    ).toBeInTheDocument()
    expect(screen.getByText('Idiomatic phrasing')).toBeInTheDocument()
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(4)
  })
})

describe('Comparison', () => {
  it('lists similar apps, including Sentiaread', () => {
    render(<Comparison />)
    expect(
      screen.getByRole('link', { name: 'Immersive Translate' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sentiaread' })).toBeInTheDocument()
  })

  it('ranks apps by users/stars descending', () => {
    render(<Comparison />)
    const names = screen.getAllByRole('link').map((a) => a.textContent)
    expect(names.indexOf('Immersive Translate')).toBeLessThan(
      names.indexOf('Sentiaread')
    )
  })

  it('shows the data-freshness disclaimer', () => {
    render(<Comparison />)
    expect(screen.getByText(/approximate as of/i)).toBeInTheDocument()
  })
})

describe('InstallCTA', () => {
  it('shows "coming soon" (not a link) for a browser with no store url', () => {
    mutableSite.edgeAddonUrl = ''
    render(<InstallCTA />)
    expect(screen.getByText(/edge — coming soon/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^edge/i })).toBeNull()
  })
})

describe('SiteFooter', () => {
  it('does not link to routes that do not exist yet', () => {
    render(<SiteFooter />)
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    // /privacy, /terms and /refund were on this list until the pages were
    // written (LAUNCH-CHECKLIST §6.2); they now exist and are asserted in
    // app/__tests__/legal.test.tsx instead. /pricing left it with §7.3.
    for (const dead of ['/docs', '/changelog']) {
      expect(hrefs).not.toContain(dead)
    }
  })

  it('shows the logo mark next to the product name', () => {
    render(<SiteFooter />)
    expect(screen.getByTestId('logo-mark')).toBeInTheDocument()
  })

  it('links to the public pricing page', () => {
    render(<SiteFooter />)
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute(
      'href',
      '/pricing'
    )
  })
})

describe('SiteHeader', () => {
  it('shows the release-stage badge next to the logo', () => {
    render(<SiteHeader />)
    expect(screen.getByRole('link', { name: /Catglish Beta/ })).toHaveAttribute(
      'href',
      '/'
    )
  })

  it('draws the logo mark beside the name, hidden from assistive tech', () => {
    render(<SiteHeader />)
    const home = screen.getByRole('link', { name: /Catglish Beta/ })
    const mark = within(home).getByTestId('logo-mark')
    expect(mark).toHaveAttribute('aria-hidden')
  })

  it('drops the badge when no stage is set', () => {
    mutableSite.stage = ''
    render(<SiteHeader />)
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })

  it('links to /pricing, and roots section links at / so they work off the landing page', () => {
    render(<SiteHeader />)
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute(
      'href',
      '/pricing'
    )
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute(
      'href',
      '/#features'
    )
  })

  it('links to the GitHub repository from the nav, in a new tab', () => {
    render(<SiteHeader />)
    const link = screen.getByRole('link', { name: 'GitHub' })
    expect(link).toHaveAttribute('href', SITE.githubUrl)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows "Add to Chrome" until the extension is detected as installed', () => {
    const { unmount } = render(<SiteHeader />)
    expect(screen.getByRole('link', { name: 'Add to Chrome' })).toHaveAttribute(
      'href',
      SITE.chromeWebStoreUrl
    )
    unmount()

    mockExtensionStatus.mockReturnValue('installed')
    render(<SiteHeader />)
    expect(
      screen.queryByRole('link', { name: 'Add to Chrome' })
    ).not.toBeInTheDocument()
  })
})
