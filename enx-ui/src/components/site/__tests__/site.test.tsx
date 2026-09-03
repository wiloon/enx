import { render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { userAtom, accessTokenAtom } from '@/store/authAtoms'
import { SITE } from '@/lib/site'

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
  it('shows "Sign in" pointing at /app when signed out', async () => {
    render(<HeaderAuthLinks />)
    const link = await screen.findByRole('link', { name: 'Sign in' })
    expect(link).toHaveAttribute('href', '/app')
  })

  it('shows "Open App" when a signed-in user is in the store', async () => {
    const store = createStore()
    store.set(userAtom, {
      id: '1',
      username: 'u',
      email: 'u@e.com',
      status: 'active',
      isLoggedIn: true,
    })
    store.set(accessTokenAtom, 'token')
    render(
      <Provider store={store}>
        <HeaderAuthLinks />
      </Provider>
    )
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
  it('has a highlighted Catseye column plus competitor columns', () => {
    render(<Comparison />)
    const catseye = screen.getByRole('columnheader', { name: 'Catseye' })
    expect(catseye).toHaveAttribute('aria-current', 'true')
    expect(
      screen.getByRole('columnheader', { name: 'Immersive Translate' })
    ).toBeInTheDocument()
  })

  it('labels every yes/partial/no cell for screen readers', () => {
    render(<Comparison />)
    expect(screen.getAllByLabelText('yes').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('partial').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('no').length).toBeGreaterThan(0)
  })

  it('shows the data-freshness disclaimer', () => {
    render(<Comparison />)
    expect(screen.getByText(/publicly available information as of/i)).toBeInTheDocument()
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
