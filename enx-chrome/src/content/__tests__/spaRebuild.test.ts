import {
  createSpaRebuilder,
  isSupportedPage,
  shouldHandleTweetNavigate,
  waitForTweetReady,
  SpaRebuilderDeps,
  NavigationLike,
} from '@/content/spaRebuild'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}

const makeDeps = (over: Partial<SpaRebuilderDeps> = {}) => {
  const calls: string[] = []
  const deps: SpaRebuilderDeps = {
    isPageSupported: jest.fn(() => true),
    waitForContentReady: jest.fn(async () => {
      calls.push('wait')
    }),
    teardown: jest.fn(() => {
      calls.push('teardown')
    }),
    rebuild: jest.fn(async () => {
      calls.push('rebuild')
    }),
    ...over,
  }
  return { deps, calls }
}

const navEvent = (
  url: string,
  over: Partial<NavigateEvent> = {}
): NavigateEvent =>
  ({
    destination: { url },
    navigationType: 'push',
    hashChange: false,
    downloadRequest: null,
    canIntercept: true,
    ...over,
  }) as NavigateEvent

class FakeNavigation implements NavigationLike {
  listeners: ((e: NavigateEvent) => void)[] = []
  addEventListener(_t: 'navigate', l: (e: NavigateEvent) => void) {
    this.listeners.push(l)
  }
  removeEventListener(_t: 'navigate', l: (e: NavigateEvent) => void) {
    this.listeners = this.listeners.filter(x => x !== l)
  }
  fire(e: NavigateEvent) {
    this.listeners.forEach(l => l(e))
  }
}

const flush = () => new Promise(r => setTimeout(r, 0))

describe('createSpaRebuilder.onRouteChange', () => {
  it('in-scope route change: tears down, waits, then rebuilds', async () => {
    const { deps, calls } = makeDeps()
    await createSpaRebuilder(deps).onRouteChange('https://x.com/a/status/1')
    expect(calls).toEqual(['teardown', 'wait', 'rebuild'])
  })

  it('out-of-scope: tears down but does not wait or rebuild', async () => {
    const { deps, calls } = makeDeps({ isPageSupported: jest.fn(() => false) })
    await createSpaRebuilder(deps).onRouteChange('https://x.com/someone')
    expect(calls).toEqual(['teardown'])
    expect(deps.rebuild).not.toHaveBeenCalled()
  })

  it('is navigation-type agnostic (a traverse URL is handled like push)', async () => {
    const { deps } = makeDeps()
    await createSpaRebuilder(deps).onRouteChange('https://x.com/b/status/2')
    expect(deps.rebuild).toHaveBeenCalledTimes(1)
  })

  it('rapid succession: only the last route change rebuilds', async () => {
    const first = deferred()
    const second = deferred()
    let n = 0
    const { deps } = makeDeps({
      waitForContentReady: jest.fn(() => (++n === 1 ? first.promise : second.promise)),
    })
    const r = createSpaRebuilder(deps)

    const a = r.onRouteChange('https://x.com/a/status/1')
    const b = r.onRouteChange('https://x.com/b/status/2')

    first.resolve()
    await a
    expect(deps.rebuild).not.toHaveBeenCalled()

    second.resolve()
    await b
    expect(deps.rebuild).toHaveBeenCalledTimes(1)
    expect(deps.teardown).toHaveBeenCalledTimes(2)
  })

  it('makeIsCurrent() reflects later route changes (initial run cancellation)', async () => {
    const { deps } = makeDeps()
    const r = createSpaRebuilder(deps)
    const isCurrent = r.makeIsCurrent()
    expect(isCurrent()).toBe(true)
    await r.onRouteChange('https://x.com/a/status/1')
    expect(isCurrent()).toBe(false)
  })
})

describe('createSpaRebuilder.start / stop', () => {
  it('start subscribes, stop unsubscribes (idempotent)', () => {
    const nav = new FakeNavigation()
    const r = createSpaRebuilder(makeDeps().deps)
    r.start(nav)
    r.start(nav)
    expect(nav.listeners).toHaveLength(1)
    r.stop()
    r.stop()
    expect(nav.listeners).toHaveLength(0)
  })

  it('a push navigate through the subscription rebuilds; a reload is ignored', async () => {
    const nav = new FakeNavigation()
    const { deps } = makeDeps()
    createSpaRebuilder(deps).start(nav)

    nav.fire(navEvent('https://x.com/a/status/1', { navigationType: 'push' }))
    await flush()
    expect(deps.rebuild).toHaveBeenCalledTimes(1)

    nav.fire(navEvent('https://x.com/a/status/1', { navigationType: 'reload' }))
    nav.fire(navEvent('https://x.com/a/status/1', { hashChange: true }))
    nav.fire(navEvent('file.pdf', { downloadRequest: 'file.pdf' }))
    await flush()
    expect(deps.rebuild).toHaveBeenCalledTimes(1)
  })
})

describe('shouldHandleTweetNavigate', () => {
  it('accepts push and traverse, rejects reload / hashChange / download', () => {
    expect(shouldHandleTweetNavigate(navEvent('u', { navigationType: 'push' }))).toBe(true)
    expect(
      shouldHandleTweetNavigate(navEvent('u', { navigationType: 'traverse' }))
    ).toBe(true)
    expect(
      shouldHandleTweetNavigate(navEvent('u', { navigationType: 'reload' }))
    ).toBe(false)
    expect(shouldHandleTweetNavigate(navEvent('u', { hashChange: true }))).toBe(false)
    expect(
      shouldHandleTweetNavigate(navEvent('u', { downloadRequest: 'x' }))
    ).toBe(false)
  })
})

describe('isSupportedPage', () => {
  it('true for a tweet detail URL, false for an X list page', () => {
    expect(isSupportedPage('https://x.com/jack/status/20')).toBe(true)
    expect(isSupportedPage('https://x.com/home')).toBe(false)
    expect(isSupportedPage('https://x.com/jack')).toBe(false)
  })

  it('true for any non-X URL (default adapter has no pageSupport gate)', () => {
    expect(isSupportedPage('https://www.infoq.com/articles/x')).toBe(true)
  })

  it('false for an unparseable URL', () => {
    expect(isSupportedPage('not a url')).toBe(false)
  })
})

describe('waitForTweetReady', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  const ready = () =>
    (document.body.innerHTML =
      '<article tabindex="-1"><div data-testid="tweetText">a new tweet</div></article>')

  it('resolves ~one debounce after the readiness selector appears', async () => {
    const p = waitForTweetReady(() => true)
    let done = false
    p.then(() => {
      done = true
    })

    ready()
    await Promise.resolve() // let the MutationObserver callback run
    jest.advanceTimersByTime(90)
    await Promise.resolve()
    expect(done).toBe(false)
    jest.advanceTimersByTime(20) // past the 100ms debounce
    await Promise.resolve()
    expect(done).toBe(true)
  })

  it('resolves via the 2s timeout when readiness never appears', async () => {
    const p = waitForTweetReady(() => true)
    let done = false
    p.then(() => {
      done = true
    })
    jest.advanceTimersByTime(1999)
    await Promise.resolve()
    expect(done).toBe(false)
    jest.advanceTimersByTime(2)
    await Promise.resolve()
    expect(done).toBe(true)
  })

  it('does not wait when already superseded (isCurrent false from the start)', async () => {
    ready() // selector matches, but the run is stale
    const p = waitForTweetReady(() => false)
    let done = false
    p.then(() => {
      done = true
    })
    await Promise.resolve()
    // The synchronous initial check() sees !isCurrent() and finishes.
    expect(done).toBe(true)
  })
})
