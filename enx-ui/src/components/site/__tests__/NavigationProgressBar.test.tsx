import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  NAVIGATION_PROGRESS_BACKSTOP_MS,
  NAVIGATION_PROGRESS_SHOW_DELAY_MS,
} from '@/lib/navigationProgress'

const mockPathname = jest.fn(() => '/')
const mockSearchParams = jest.fn(() => new URLSearchParams())

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams(),
}))

import NavigationProgressBar from '../NavigationProgressBar'
import HomeLink from '../HomeLink'

function bar() {
  return document.querySelector('[data-testid="navigation-progress"]')
}

function mountBar() {
  return render(
    <>
      <NavigationProgressBar />
      <a href="/pricing">Pricing</a>
      <a href="/pricing?plan=pro">Pro plan</a>
      <a href="/a">To A</a>
      <a href="#features">Features</a>
      <a href="/pricing">Same pricing</a>
      <a href="https://other.example.com/x">External</a>
      <a href="/blank" target="_blank">
        Blank
      </a>
      <a href="/file" download>
        Download
      </a>
      <a href="/skip" data-no-progress>
        Skip
      </a>
    </>
  )
}

function clickLink(name: string, init?: MouseEventInit) {
  fireEvent.click(screen.getByRole('link', { name }), init)
}

function setRoute(pathname: string, search = '') {
  mockPathname.mockReturnValue(pathname)
  mockSearchParams.mockReturnValue(new URLSearchParams(search))
}

function preventDefaultNav(event: Event) {
  // jsdom cannot follow <a href>; swallow the default so fake timers don't
  // trip "navigation (except hash changes)" console errors.
  event.preventDefault()
}

beforeEach(() => {
  jest.useFakeTimers()
  mockPathname.mockReturnValue('/')
  mockSearchParams.mockReturnValue(new URLSearchParams())
  window.history.replaceState(null, '', '/')
  window.scrollTo = jest.fn()
  document.addEventListener('click', preventDefaultNav)
})

afterEach(() => {
  document.removeEventListener('click', preventDefaultNav)
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

describe('NavigationProgressBar', () => {
  it('shows the bar after the delay on a path-change click, then hides on pathname change', () => {
    const { rerender } = mountBar()
    clickLink('Pricing')
    expect(bar()).toBeNull()

    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).not.toBeNull()

    setRoute('/pricing')
    rerender(
      <>
        <NavigationProgressBar />
        <a href="/pricing">Pricing</a>
      </>
    )
    expect(bar()).toBeNull()
  })

  it('shows the bar on a query-only change and hides when search params change', () => {
    setRoute('/pricing')
    window.history.replaceState(null, '', '/pricing')
    const { rerender } = mountBar()
    clickLink('Pro plan')
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).not.toBeNull()

    setRoute('/pricing', 'plan=pro')
    rerender(
      <>
        <NavigationProgressBar />
        <a href="/pricing?plan=pro">Pro plan</a>
      </>
    )
    expect(bar()).toBeNull()
  })

  it('hides on a redirect to a URL other than the link href', () => {
    const { rerender } = mountBar()
    clickLink('To A')
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).not.toBeNull()

    setRoute('/b')
    rerender(
      <>
        <NavigationProgressBar />
        <a href="/a">To A</a>
      </>
    )
    expect(bar()).toBeNull()
  })

  it('never flashes when the route changes before the show delay', () => {
    const { rerender } = mountBar()
    clickLink('Pricing')
    setRoute('/pricing')
    rerender(
      <>
        <NavigationProgressBar />
        <a href="/pricing">Pricing</a>
      </>
    )
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS + 50)
    })
    expect(bar()).toBeNull()
  })

  it.each([
    ['modifier click', { metaKey: true }, 'Pricing'],
    ['middle click', { button: 1 }, 'Pricing'],
  ] as const)('shows no bar for a %s', (_label, init, name) => {
    mountBar()
    clickLink(name, init)
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).toBeNull()
  })

  it.each([
    ['target="_blank"', 'Blank'],
    ['download', 'Download'],
    ['external', 'External'],
    ['hash-only', 'Features'],
    ['data-no-progress', 'Skip'],
  ] as const)('shows no bar for %s', (_label, name) => {
    mountBar()
    clickLink(name)
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).toBeNull()
  })

  it('shows no bar for a link to the current URL', () => {
    setRoute('/pricing')
    window.history.replaceState(null, '', '/pricing')
    mountBar()
    clickLink('Same pricing')
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).toBeNull()
  })

  it('shows no bar when HomeLink on / is clicked', () => {
    render(
      <>
        <NavigationProgressBar />
        <HomeLink className="">Catglish</HomeLink>
      </>
    )
    fireEvent.click(screen.getByRole('link', { name: 'Catglish' }))
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).toBeNull()
  })

  it('superseded: older navigation renders first and clears the bar for good', () => {
    const { rerender } = mountBar()
    clickLink('To A')
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).not.toBeNull()

    clickLink('Pricing')
    setRoute('/a')
    rerender(
      <>
        <NavigationProgressBar />
        <a href="/a">To A</a>
        <a href="/pricing">Pricing</a>
      </>
    )
    expect(bar()).toBeNull()

    act(() => {
      jest.advanceTimersByTime(
        NAVIGATION_PROGRESS_SHOW_DELAY_MS + NAVIGATION_PROGRESS_BACKSTOP_MS
      )
    })
    expect(bar()).toBeNull()
  })

  it('superseded: latest navigation renders and clears the bar for good', () => {
    const { rerender } = mountBar()
    clickLink('To A')
    clickLink('Pricing')
    setRoute('/pricing')
    rerender(
      <>
        <NavigationProgressBar />
        <a href="/a">To A</a>
        <a href="/pricing">Pricing</a>
      </>
    )
    expect(bar()).toBeNull()

    act(() => {
      jest.advanceTimersByTime(
        NAVIGATION_PROGRESS_SHOW_DELAY_MS + NAVIGATION_PROGRESS_BACKSTOP_MS
      )
    })
    expect(bar()).toBeNull()
  })

  it('superseded: restarts the 15 s backstop', () => {
    mountBar()
    clickLink('To A')
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).not.toBeNull()

    act(() => {
      jest.advanceTimersByTime(10_000)
    })
    clickLink('Pricing')
    act(() => {
      jest.advanceTimersByTime(10_000)
    })
    expect(bar()).not.toBeNull()

    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_BACKSTOP_MS - 10_000 + 1)
    })
    expect(bar()).toBeNull()
  })

  it('ends on popstate while pending', () => {
    mountBar()
    clickLink('Pricing')
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).not.toBeNull()

    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(bar()).toBeNull()
  })

  it('ends on the 15 s backstop', () => {
    mountBar()
    clickLink('Pricing')
    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_SHOW_DELAY_MS)
    })
    expect(bar()).not.toBeNull()

    act(() => {
      jest.advanceTimersByTime(NAVIGATION_PROGRESS_BACKSTOP_MS)
    })
    expect(bar()).toBeNull()
  })

  it('clears pending timers and stops listening for clicks on unmount', () => {
    const { unmount } = mountBar()
    clickLink('Pricing')
    expect(jest.getTimerCount()).toBe(2)

    unmount()
    expect(jest.getTimerCount()).toBe(0)

    const link = document.createElement('a')
    link.href = '/pricing'
    document.body.appendChild(link)
    fireEvent.click(link)
    expect(jest.getTimerCount()).toBe(0)
    link.remove()
  })
})
