import {
  resolveSiteAdapter,
  pickFocusedTweet,
  DEFAULT_ADAPTER,
} from '@/lib/siteAdapters'

const loc = (hostname: string, pathname: string) =>
  ({ hostname, pathname }) as Location

describe('resolveSiteAdapter', () => {
  it('returns the default adapter for whitelisted article sites', () => {
    expect(resolveSiteAdapter(loc('claude.com', '/blog/some-post'))).toBe(
      DEFAULT_ADAPTER
    )
    expect(resolveSiteAdapter(loc('www.infoq.com', '/articles/x'))).toBe(
      DEFAULT_ADAPTER
    )
  })

  it('default adapter reproduces today behavior field-for-field', () => {
    expect(DEFAULT_ADAPTER).toMatchObject({
      minTextLength: 100,
      highlightStrategy: 'innerHTML',
      showProcessingIndicator: true,
    })
    expect(DEFAULT_ADAPTER.contentSelector).toBeUndefined()
    expect(DEFAULT_ADAPTER.focusedNodeResolver).toBeUndefined()
    expect(DEFAULT_ADAPTER.pageSupport).toBeUndefined()
  })

  it('matches x.com and twitter.com (incl. subdomains)', () => {
    for (const host of ['x.com', 'twitter.com', 'www.x.com', 'mobile.twitter.com']) {
      expect(resolveSiteAdapter(loc(host, '/user/status/1')).name).toBe('x')
    }
  })

  it('does not match hosts that merely end in a similar string', () => {
    expect(resolveSiteAdapter(loc('notx.com', '/a')).name).toBe('default')
    expect(resolveSiteAdapter(loc('x.com.evil.net', '/a')).name).toBe('default')
  })

  describe('X adapter pageSupport gate', () => {
    const x = resolveSiteAdapter(loc('x.com', '/'))

    it('allows a tweet detail page', () => {
      expect(x.pageSupport!(loc('x.com', '/jack/status/20'))).toBeNull()
      expect(
        x.pageSupport!(loc('x.com', '/jack/status/20/photo/1'))
      ).toBeNull()
    })

    it('rejects timeline / search / profile pages with a message', () => {
      for (const path of ['/', '/home', '/explore', '/search', '/jack']) {
        expect(x.pageSupport!(loc('x.com', path))).toMatch(/推文详情页/)
      }
    })

    it('pins the tweetText selector and the in-place strategy', () => {
      expect(x.contentSelector).toBe('div[data-testid="tweetText"]')
      expect(x.highlightStrategy).toBe('inPlace')
      expect(x.showProcessingIndicator).toBe(false)
      expect(x.minTextLength).toBe(1)
    })
  })
})

describe('pickFocusedTweet', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const tweetTexts = () =>
    Array.from(document.querySelectorAll('div[data-testid="tweetText"]'))

  it('returns the node unchanged when there is only one', () => {
    document.body.innerHTML =
      '<article tabindex="-1"><div data-testid="tweetText">solo</div></article>'
    const nodes = tweetTexts()
    expect(pickFocusedTweet(nodes)).toEqual(nodes)
  })

  it('picks the tweet whose <article> has tabindex="-1" on a conversation page', () => {
    document.body.innerHTML = `
      <article tabindex="0">
        <a href="/alice/status/111">link</a>
        <div data-testid="tweetText">ancestor tweet</div>
      </article>
      <article tabindex="-1">
        <div data-testid="tweetText">the opened tweet body</div>
      </article>
      <article tabindex="0">
        <a href="/carol/status/333">link</a>
        <div data-testid="tweetText">a reply</div>
      </article>
    `
    const focused = pickFocusedTweet(tweetTexts())
    expect(focused).toHaveLength(1)
    expect(focused[0].textContent).toBe('the opened tweet body')
  })

  it('falls back to DOM order (with a warning) when no criterion resolves one node', () => {
    // Both replies: tabindex 0, no size info in jsdom, both carry a self /status/ link.
    document.body.innerHTML = `
      <article tabindex="0">
        <a href="/alice/status/111">link</a>
        <div data-testid="tweetText">first</div>
      </article>
      <article tabindex="0">
        <a href="/bob/status/222">link</a>
        <div data-testid="tweetText">second</div>
      </article>
    `
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const focused = pickFocusedTweet(tweetTexts())
    expect(focused).toHaveLength(1)
    expect(focused[0].textContent).toBe('first')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pickFocusedTweet'))
    warn.mockRestore()
  })

  it('uses the "no self-status-link" criterion when tabindex is absent', () => {
    document.body.innerHTML = `
      <article>
        <a href="/alice/status/111">link</a>
        <div data-testid="tweetText">ancestor</div>
      </article>
      <article>
        <div data-testid="tweetText">main, no permalink to itself</div>
      </article>
    `
    const focused = pickFocusedTweet(tweetTexts())
    expect(focused).toHaveLength(1)
    expect(focused[0].textContent).toBe('main, no permalink to itself')
  })
})
