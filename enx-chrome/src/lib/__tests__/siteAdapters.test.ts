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
      contentVolatility: 'static',
      showProcessingIndicator: true,
    })
    expect(DEFAULT_ADAPTER.contentSelector).toBeUndefined()
    expect(DEFAULT_ADAPTER.focusedNodeResolver).toBeUndefined()
    expect(DEFAULT_ADAPTER.pageSupport).toBeUndefined()
    expect(DEFAULT_ADAPTER.clickBinding).toBeUndefined() // defaults to 'bubble'
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

    it('pins the tweetText selector and marks the content SPA-volatile', () => {
      expect(x.contentSelector).toBe('div[data-testid="tweetText"]')
      expect(x.contentVolatility).toBe('spa')
      expect(x.clickBinding).toBe('bubble')
      expect(x.showProcessingIndicator).toBe(false)
      expect(x.minTextLength).toBe(1)
    })
  })
})

describe('pickFocusedTweet', () => {
  // ADR-010 §2.2 shipped three fallback criteria for finding the opened
  // tweet: (1) article[tabindex="-1"], (2) largest font size, (3) the
  // article with no self /status/ link. Browser testing
  // (adr-010-phase2-dom-readiness.md §3) showed (2) and (3) are both wrong,
  // so only (1) remains. The two tests below lock in that removal.
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const tweetTexts = () =>
    Array.from(document.querySelectorAll('div[data-testid="tweetText"]'))

  it('returns the node unchanged on a standalone tweet page (single node)', () => {
    document.body.innerHTML =
      '<article tabindex="-1"><div data-testid="tweetText">solo</div></article>'
    const nodes = tweetTexts()
    expect(pickFocusedTweet(nodes)).toEqual(nodes)
  })

  it('picks only the tabindex="-1" tweet on a conversation page (ancestor + main + reply)', () => {
    // The main tweet's <article> carries /status/ links (permalink); that no
    // longer disqualifies it.
    document.body.innerHTML = `
      <article tabindex="0">
        <a href="/alice/status/111">link</a>
        <div data-testid="tweetText">ancestor tweet</div>
      </article>
      <article tabindex="-1">
        <a href="/bob/status/222">permalink</a>
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

  it('takes the last focused article when two coexist (SPA tweet-switch handoff)', () => {
    // adr-010-phase2-dom-readiness.md §3: during the ~750ms handoff the
    // outgoing and incoming main-tweet <article>s both carry tabindex="-1".
    document.body.innerHTML = `
      <article tabindex="-1">
        <div data-testid="tweetText">the tweet being navigated away from</div>
      </article>
      <article tabindex="-1">
        <div data-testid="tweetText">the tweet just navigated to</div>
      </article>
    `
    const focused = pickFocusedTweet(tweetTexts())
    expect(focused).toHaveLength(1)
    expect(focused[0].textContent).toBe('the tweet just navigated to')
  })

  it('ignores the removed font-size criterion when no article is focused', () => {
    // No article[tabindex="-1"]. The old code would pick the larger-font
    // node (here the reply); the new code falls back to DOM order.
    document.body.innerHTML = `
      <article tabindex="0">
        <a href="/a/status/1">l</a>
        <div data-testid="tweetText" style="font-size: 15px">first (main)</div>
      </article>
      <article tabindex="0">
        <a href="/b/status/2">l</a>
        <div data-testid="tweetText" style="font-size: 30px">second (reply, bigger font)</div>
      </article>
    `
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const focused = pickFocusedTweet(tweetTexts())
    expect(focused[0].textContent).toBe('first (main)')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('ignores the removed no-self-status-link criterion when no article is focused', () => {
    // No article[tabindex="-1"]. The old code would pick the second node
    // (its article has no /status/ link); the new code falls back to DOM order.
    document.body.innerHTML = `
      <article tabindex="0">
        <a href="/a/status/1">permalink</a>
        <div data-testid="tweetText">first</div>
      </article>
      <article tabindex="0">
        <div data-testid="tweetText">second (no self link)</div>
      </article>
    `
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const focused = pickFocusedTweet(tweetTexts())
    expect(focused[0].textContent).toBe('first')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('picks the main body, not the quoted body, on a quote-tweet page', () => {
    // A quoted tweet renders inside the SAME article[tabindex="-1"] as the
    // main body (it is a role="link" block, not a nested <article>), so the
    // selector matches two tweetText nodes. The main body comes first -- and
    // this resolves cleanly, without the DOM-order fallback warning.
    document.body.innerHTML = `
      <article tabindex="-1">
        <a href="/bob/status/222">permalink</a>
        <div data-testid="tweetText">the main tweet body</div>
        <div role="link" tabindex="0">
          <a href="/dana/status/444">quoted permalink</a>
          <div data-testid="tweetText">the quoted tweet body</div>
        </div>
      </article>
    `
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const focused = pickFocusedTweet(tweetTexts())
    expect(focused).toHaveLength(1)
    expect(focused[0].textContent).toBe('the main tweet body')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('falls back to DOM order (with a warning) when no article is marked focused', () => {
    document.body.innerHTML = `
      <article tabindex="0">
        <div data-testid="tweetText">first</div>
      </article>
      <article tabindex="0">
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
})
