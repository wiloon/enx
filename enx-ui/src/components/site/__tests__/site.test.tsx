import { render, screen } from '@testing-library/react'
import { SITE } from '@/lib/site'

const mockUseAuth = jest.fn(() => ({ isSignedIn: false }))
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => mockUseAuth(),
}))

import HeaderAuthLinks from '../HeaderAuthLinks'
import Hero from '../Hero'
import DemoVideo from '../DemoVideo'
import FeatureSection from '../FeatureSection'
import Comparison from '../Comparison'
import InstallCTA from '../InstallCTA'
import SiteFooter from '../SiteFooter'

jest.mock('@/lib/site', () => {
  const actual = jest.requireActual('@/lib/site')
  return { SITE: { ...actual.SITE } }
})

const mutableSite = SITE as { -readonly [K in keyof typeof SITE]: (typeof SITE)[K] }
const original = { ...SITE }
afterEach(() => Object.assign(mutableSite, original))

describe('HeaderAuthLinks', () => {
  beforeEach(() => mockUseAuth.mockReturnValue({ isSignedIn: false }))

  it('shows "Sign in" pointing at /app when signed out', async () => {
    render(<HeaderAuthLinks />)
    const link = await screen.findByRole('link', { name: 'Sign in' })
    expect(link).toHaveAttribute('href', '/app')
  })

  it('shows "Open App" when Clerk reports a signed-in viewer', async () => {
    mockUseAuth.mockReturnValue({ isSignedIn: true })
    render(<HeaderAuthLinks />)
    expect(await screen.findByRole('link', { name: 'Open App' })).toBeInTheDocument()
  })
})

describe('Hero', () => {
  it('links the primary CTA to the Chrome Web Store', () => {
    render(<Hero />)
    const cta = screen.getByRole('link', { name: /add to chrome/i })
    expect(cta).toHaveAttribute('href', SITE.chromeWebStoreUrl)
    expect(screen.getByRole('link', { name: /see how it works/i })).toHaveAttribute(
      'href',
      '#how-it-works'
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
    expect(screen.getByText('Word highlight while you read')).toBeInTheDocument()
    expect(screen.getByText('Idiomatic phrasing')).toBeInTheDocument()
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(4)
  })
})

describe('Comparison', () => {
  it('lists similar apps, including Sentiaread', () => {
    render(<Comparison />)
    expect(screen.getByRole('link', { name: 'Immersive Translate' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sentiaread' })).toBeInTheDocument()
  })

  it('ranks apps by users/stars descending', () => {
    render(<Comparison />)
    const names = screen.getAllByRole('link').map((a) => a.textContent)
    expect(names.indexOf('Immersive Translate')).toBeLessThan(names.indexOf('Sentiaread'))
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
    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
    for (const dead of ['/docs', '/pricing', '/changelog', '/privacy']) {
      expect(hrefs).not.toContain(dead)
    }
  })
})
