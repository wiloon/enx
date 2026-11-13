import { fireEvent, render, screen, within } from '@testing-library/react'
import { SITE } from '@/lib/site'
import { SUBSCRIPTION_PLANS } from '@/lib/plans'

const mockUseAuth = jest.fn(() => ({ isLoaded: true, isSignedIn: false }))
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
import HowItWorks from '../HowItWorks'
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

it('offers public Help from the site header and footer', () => {
  const { unmount } = render(<SiteHeader />)
  expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute(
    'href',
    '/help'
  )
  unmount()
  render(<SiteFooter />)
  expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute(
    'href',
    '/help'
  )
})
afterEach(() => {
  Object.assign(mutableSite, original)
  mockExtensionStatus.mockReturnValue('not-installed')
})

describe('HeaderAuthLinks', () => {
  beforeEach(() =>
    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: false })
  )

  it('shows a spinner, not "Sign in", while Clerk is still loading', () => {
    mockUseAuth.mockReturnValue({ isLoaded: false, isSignedIn: false })
    render(<HeaderAuthLinks />)
    expect(screen.getByRole('status')).toHaveAccessibleName(
      'Checking sign-in status'
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows "Sign in" pointing at /app when signed out', async () => {
    render(<HeaderAuthLinks />)
    const link = await screen.findByRole('link', { name: 'Sign in' })
    expect(link).toHaveAttribute('href', '/app')
  })

  it('shows "Go to app" when Clerk reports a signed-in viewer', async () => {
    mockUseAuth.mockReturnValue({ isLoaded: true, isSignedIn: true })
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
  })

  it('points a visitor without the extension at how it works, not the sample', () => {
    render(<Hero />)
    expect(
      screen.getByRole('link', { name: 'See how it works' })
    ).toHaveAttribute('href', '#how-it-works')
    // Lookups need the extension, so the sample would do nothing yet.
    expect(
      screen.queryByRole('link', { name: 'Try it on a sample article' })
    ).not.toBeInTheDocument()
  })

  it('offers the sample article once the extension is installed', () => {
    mockExtensionStatus.mockReturnValue('installed')
    render(<Hero />)
    expect(
      screen.getByRole('link', { name: 'Try it on a sample article' })
    ).toHaveAttribute('href', '/reader/sample')
  })

  it('keeps the subtitle to the two core actions, one short line', () => {
    render(<Hero />)
    expect(screen.getByText(SITE.subtitle).textContent!.length).toBeLessThan(80)
  })

  it('offers neither the store CTA nor "Go to app" while extension detection is pending', () => {
    mockExtensionStatus.mockReturnValue('unknown')
    render(<Hero />)
    expect(
      screen.queryByRole('link', { name: /add to chrome/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Go to app' })
    ).not.toBeInTheDocument()
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

  describe('with an mp4 url', () => {
    let play: jest.SpyInstance
    const setReducedMotion = (reduce: boolean) => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
        media: query,
      }))
    }

    beforeEach(() => {
      mutableSite.demoVideoUrl = 'https://example.com/demo.mp4'
      // jsdom has no media playback; play() would throw "not implemented".
      play = jest
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockResolvedValue(undefined)
    })
    afterEach(() => play.mockRestore())

    it('renders a <video> with preload="none" and a poster', () => {
      setReducedMotion(false)
      const { container } = render(<DemoVideo />)
      const video = container.querySelector('video')
      expect(video).not.toBeNull()
      expect(video).toHaveAttribute('preload', 'none')
      expect(video).toHaveAttribute('poster', SITE.demoPoster)
    })

    it('plays muted, looped and inline with no controls', () => {
      setReducedMotion(false)
      const { container } = render(<DemoVideo />)
      const video = container.querySelector('video') as HTMLVideoElement
      expect(play).toHaveBeenCalled()
      expect(video.muted).toBe(true)
      expect(video.loop).toBe(true)
      expect(video).toHaveAttribute('playsinline')
      expect(video).not.toHaveAttribute('controls')
    })

    it('stays on the poster with controls under prefers-reduced-motion', () => {
      setReducedMotion(true)
      const { container } = render(<DemoVideo />)
      const video = container.querySelector('video') as HTMLVideoElement
      expect(play).not.toHaveBeenCalled()
      expect(video).toHaveAttribute('controls')
    })
  })
})

describe('FeatureSection', () => {
  it('leads with click-to-look-up and covers only the reading features', () => {
    render(<FeatureSection />)
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    ).toEqual([
      'Click any word for its meaning',
      'Select a sentence to translate it',
      'Word highlight while you read',
    ])
    // Rephrase is a writing tool; it is explained in Help, not here.
    expect(screen.queryByText(/idiomatic/i)).not.toBeInTheDocument()
    // Real screenshots, not the empty placeholder boxes.
    expect(
      screen.getAllByRole('img').map((img) => img.getAttribute('src'))
    ).toEqual([
      '/landing/click-word.png',
      '/landing/translate-sentence.png',
      '/landing/word-highlight.png',
    ])
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

  it('links open-source apps to their own website, in a new tab', () => {
    render(<Comparison />)
    const link = screen.getByRole('link', { name: 'Saladict' })
    expect(link).toHaveAttribute('href', 'https://saladict.crimx.com')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('lists Catglish itself, ranked by users like the others', () => {
    render(<Comparison />)
    const names = screen.getAllByRole('link').map((a) => a.textContent)
    expect(names.at(-1)).toBe('Catglish')
    expect(screen.getByRole('link', { name: 'Catglish' })).toHaveAttribute(
      'href',
      SITE.chromeWebStoreUrl
    )
  })

  it('shows Catglish as New instead of a user count', () => {
    render(<Comparison />)
    const row = screen.getByRole('link', { name: 'Catglish' }).closest('li')!
    expect(row).toHaveTextContent(/\bNew\b/)
    expect(row).not.toHaveTextContent(/users/)
  })

  it('shows the data-freshness disclaimer', () => {
    render(<Comparison />)
    expect(screen.getByText(/approximate as of/i)).toBeInTheDocument()
  })
})

describe('HowItWorks', () => {
  it('tells new users to pin the icon, which Chrome hides by default', () => {
    render(<HowItWorks />)
    expect(screen.getByText(/pin the Catglish icon/i)).toBeInTheDocument()
  })
})

describe('InstallCTA', () => {
  it('links Add to Chrome to the store for a visitor without the extension', () => {
    render(<InstallCTA />)
    expect(screen.getByRole('link', { name: 'Add to Chrome' })).toHaveAttribute(
      'href',
      SITE.chromeWebStoreUrl
    )
  })

  it('swaps Add to Chrome for "Go to app" once the extension is installed', () => {
    mockExtensionStatus.mockReturnValue('installed')
    render(<InstallCTA />)
    expect(
      screen.queryByRole('link', { name: 'Add to Chrome' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to app' })).toHaveAttribute(
      'href',
      SITE.appPath
    )
  })

  it('names browsers with no store url as plain text, not as buttons', () => {
    mutableSite.edgeAddonUrl = ''
    mutableSite.firefoxAddonUrl = ''
    render(<InstallCTA />)
    expect(
      screen.getByText('Edge and Firefox coming soon.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /edge|firefox/i })).toBeNull()
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

  it('links to the GitHub repository with an icon beside Sign in, in a new tab', () => {
    render(<SiteHeader />)
    const link = screen.getByRole('link', { name: 'GitHub' })
    expect(link).toHaveAttribute('href', SITE.githubUrl)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveTextContent('')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).queryByRole('link', { name: 'GitHub' })).toBeNull()
  })

  it('lists Help with the other section links and leaves installing to the CTA', () => {
    render(<SiteHeader />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent)
    ).toEqual(['Features', 'How it works', 'Pricing', 'Similar apps', 'Help'])
  })

  describe('mobile menu', () => {
    it('opens a menu with the section links and GitHub', () => {
      render(<SiteHeader />)
      const toggle = screen.getByRole('button', { name: 'Open menu' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull()

      fireEvent.click(toggle)

      expect(
        screen.getByRole('button', { name: 'Close menu' })
      ).toHaveAttribute('aria-expanded', 'true')
      const menu = screen.getByRole('navigation', { name: 'Menu' })
      expect(
        within(menu)
          .getAllByRole('link')
          .map((a) => a.textContent)
      ).toEqual([
        'Features',
        'How it works',
        'Pricing',
        'Similar apps',
        'Help',
        'GitHub',
        // The bar has no room for the CTA on a phone, so the menu carries it.
        'Add to Chrome',
      ])
    })

    it('closes when a link is chosen, so a same-page anchor is not hidden behind it', () => {
      render(<SiteHeader />)
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
      const menu = screen.getByRole('navigation', { name: 'Menu' })
      fireEvent.click(within(menu).getByRole('link', { name: 'Features' }))
      expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull()
    })

    it('closes on Escape and hands focus back to the toggle', () => {
      render(<SiteHeader />)
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus()
    })
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

  it('offers no "Add to Chrome" link while the extension check is pending', () => {
    mockExtensionStatus.mockReturnValue('unknown')
    render(<SiteHeader />)
    expect(
      screen.queryByRole('link', { name: 'Add to Chrome' })
    ).not.toBeInTheDocument()
  })
})
