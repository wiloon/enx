import {
  resolveSiteAdapter,
  pickFocusedTweet,
  X_CONTENT_SELECTOR,
  X_READY_SELECTOR,
  DEFAULT_ADAPTER,
  PageLocation,
  SiteOrigins,
} from '@/lib/siteAdapters'
import { WordProcessor } from '@/lib/wordProcessor'

// `host` includes the port (as on window.location); hostname drops it.
const loc = (host: string, pathname: string): PageLocation => ({
  host,
  hostname: host.split(':')[0],
  pathname,
})

// The site recognition each build is stamped with (targets.ts, #231).
const HOMELAB: SiteOrigins = {
  uiOrigins: ['http://localhost:3000', 'https://enx.wiloon.lab'],
  rssxOrigins: ['https://rssx-lab.wiloon.com'],
}
const DEVELOPMENT: SiteOrigins = {
  uiOrigins: ['http://localhost:3000'],
  rssxOrigins: ['https://rssx-lab.wiloon.com'],
}
const PRODUCTION: SiteOrigins = {
  uiOrigins: ['https://catglish.com'],
  rssxOrigins: [],
}

describe('resolveSiteAdapter', () => {
  it('returns the default adapter for whitelisted article sites', () => {
    expect(
      resolveSiteAdapter(loc('claude.com', '/blog/some-post'), HOMELAB)
    ).toBe(DEFAULT_ADAPTER)
    expect(
      resolveSiteAdapter(loc('www.infoq.com', '/articles/x'), HOMELAB)
    ).toBe(DEFAULT_ADAPTER)
  })

  it('default adapter reproduces today behavior field-for-field', () => {
    expect(DEFAULT_ADAPTER).toMatchObject({
      minTextLength: 100,
      contentVolatility: 'static',
    })
    expect(DEFAULT_ADAPTER.contentSelector).toBeUndefined()
    expect(DEFAULT_ADAPTER.focusedNodeResolver).toBeUndefined()
    expect(DEFAULT_ADAPTER.pageSupport).toBeUndefined()
    expect(DEFAULT_ADAPTER.clickBinding).toBeUndefined() // defaults to 'bubble'
  })

  it('matches x.com and twitter.com (incl. subdomains)', () => {
    for (const host of [
      'x.com',
      'twitter.com',
      'www.x.com',
      'mobile.twitter.com',
    ]) {
      expect(
        resolveSiteAdapter(loc(host, '/user/status/1'), HOMELAB).name
      ).toBe('x')
    }
  })

  it('does not match hosts that merely end in a similar string', () => {
    expect(resolveSiteAdapter(loc('notx.com', '/a'), HOMELAB).name).toBe(
      'default'
    )
    expect(resolveSiteAdapter(loc('x.com.evil.net', '/a'), HOMELAB).name).toBe(
      'default'
    )
  })

  describe('X adapter pageSupport gate', () => {
    const x = resolveSiteAdapter(loc('x.com', '/'), HOMELAB)

    it('allows a tweet detail page', () => {
      expect(x.pageSupport!(loc('x.com', '/jack/status/20'))).toBeNull()
      expect(x.pageSupport!(loc('x.com', '/jack/status/20/photo/1'))).toBeNull()
    })

    it('rejects timeline / search / profile pages with a message', () => {
      for (const path of ['/', '/home', '/explore', '/search', '/jack']) {
        expect(x.pageSupport!(loc('x.com', path))).toMatch(/tweet detail pages/)
      }
    })

    it('allows an X Article, which shares the /status/ URL shape', () => {
      expect(
        x.pageSupport!(loc('x.com', '/sairahul1/status/2089995692874068433'))
      ).toBeNull()
    })

    it('pins the tweetText + article-body selectors and marks the content SPA-volatile', () => {
      expect(x.contentSelector).toBe(
        'div[data-testid="tweetText"], [data-testid="twitterArticleRichTextView"]'
      )
      expect(x.contentVolatility).toBe('spa')
      expect(x.clickBinding).toBe('bubble')
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

  it('picks the article body on an X Article page, ahead of replies and its own duplicate article', () => {
    // Verified in Chrome (2026-09-20): an Article page has no tweetText in the
    // opened post, two article[tabindex="-1"] (the body is in the last), and
    // replies below as tabindex="0" tweetText articles.
    document.body.innerHTML = `
      <article tabindex="-1"><div data-testid="twitter-article-title">title</div></article>
      <article tabindex="-1">
        <div data-testid="twitterArticleReadView">
          <div data-testid="twitterArticleRichTextView">the article body</div>
        </div>
      </article>
      <article tabindex="0">
        <div data-testid="tweetText">a reply under the article</div>
      </article>
    `
    const nodes = Array.from(document.querySelectorAll(X_CONTENT_SELECTOR))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const focused = pickFocusedTweet(nodes)
    expect(focused).toHaveLength(1)
    expect(focused[0].textContent).toBe('the article body')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns a lone article body unchanged (no replies loaded yet)', () => {
    document.body.innerHTML = `
      <article tabindex="-1">
        <div data-testid="twitterArticleRichTextView">the article body</div>
      </article>
    `
    const nodes = Array.from(document.querySelectorAll(X_CONTENT_SELECTOR))
    expect(pickFocusedTweet(nodes)).toEqual(nodes)
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
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('pickFocusedTweet')
    )
    warn.mockRestore()
  })
})

// ADR-019: enx-ui's /reader page renders user-pasted plain text as an
// article; the extension treats it like any whitelisted article site, but
// only on the /reader route (the app's other pages -- lookup, rephrase,
// billing -- are not meant to be read by the extension).
describe('READER_ADAPTER (enx-ui paste-text reader)', () => {
  // #231: the build target's uiOrigins decide which hosts are enx-ui.
  it.each([
    ['homelab', HOMELAB, ['localhost:3000', 'enx.wiloon.lab']],
    ['development', DEVELOPMENT, ['localhost:3000']],
    ['production', PRODUCTION, ['catglish.com']],
  ] as [string, SiteOrigins, string[]][])(
    'matches the enx-ui hosts of the %s build',
    (_, origins, hosts) => {
      for (const host of hosts) {
        expect(resolveSiteAdapter(loc(host, '/reader'), origins).name).toBe(
          'reader'
        )
      }
    }
  )

  it('leaves the other builds enx-ui hosts as ordinary sites', () => {
    for (const host of ['localhost:3000', 'enx.wiloon.lab']) {
      expect(resolveSiteAdapter(loc(host, '/reader'), PRODUCTION).name).toBe(
        'default'
      )
    }
    expect(
      resolveSiteAdapter(loc('catglish.com', '/reader'), HOMELAB).name
    ).toBe('default')
  })

  // No target declares the legacy host any more.
  it('does not match the undeclared enx.wiloon.com', () => {
    for (const origins of [HOMELAB, DEVELOPMENT, PRODUCTION]) {
      expect(
        resolveSiteAdapter(loc('enx.wiloon.com', '/reader'), origins).name
      ).toBe('default')
    }
  })

  it('tells localhost ports apart', () => {
    // E2E fixture pages are served from localhost:8765; they are ordinary
    // article pages, not enx-ui.
    expect(
      resolveSiteAdapter(loc('localhost:8765', '/reader'), DEVELOPMENT).name
    ).toBe('default')
    const fixtureOnly = {
      uiOrigins: ['http://localhost:8765'],
      rssxOrigins: [],
    }
    expect(
      resolveSiteAdapter(loc('localhost:3000', '/reader'), fixtureOnly).name
    ).toBe('default')
    expect(
      resolveSiteAdapter(loc('localhost:8765', '/reader'), fixtureOnly).name
    ).toBe('reader')
  })

  it('does not match unrelated or lookalike hosts', () => {
    for (const host of [
      'www.infoq.com',
      'catglish.com.evil.net',
      'evilcatglish.com',
      'www.catglish.com',
      'enx.wiloon.lab.evil.net',
    ]) {
      expect(resolveSiteAdapter(loc(host, '/reader'), PRODUCTION).name).toBe(
        'default'
      )
      expect(resolveSiteAdapter(loc(host, '/reader'), HOMELAB).name).toBe(
        'default'
      )
    }
  })

  describe('pageSupport gate', () => {
    const reader = resolveSiteAdapter(loc('enx.wiloon.lab', '/reader'), HOMELAB)

    it('allows the /reader route', () => {
      expect(reader.pageSupport!(loc('enx.wiloon.lab', '/reader'))).toBeNull()
    })

    // ADR-047 Decision 5: the sample article is embedded in /welcome.
    it('allows /welcome', () => {
      expect(reader.pageSupport!(loc('enx.wiloon.lab', '/welcome'))).toBeNull()
    })

    it('rejects every other enx-ui page with a message', () => {
      for (const path of [
        '/',
        '/app',
        '/lookup',
        '/rephrase',
        '/billing',
        '/welcomes',
      ]) {
        expect(reader.pageSupport!(loc('enx.wiloon.lab', path))).toEqual(
          expect.stringMatching(/reader/i)
        )
      }
    })
  })

  it('pins a dedicated content container and treats it as static', () => {
    const reader = resolveSiteAdapter(loc('enx.wiloon.lab', '/reader'), HOMELAB)
    expect(reader.contentSelector).toBe('#enx-reader-article')
    expect(reader.contentVolatility).toBe('static')
    expect(reader.clickBinding).toBe('bubble')
    expect(reader.minTextLength).toBe(1)
  })
})

describe('RSSX adapter (ADR-033 reading pane)', () => {
  // #231: only the builds that declare the RSSX origin adapt to it.
  it.each([
    ['homelab', HOMELAB, 'rssx'],
    ['development', DEVELOPMENT, 'rssx'],
    ['production', PRODUCTION, 'default'],
  ] as [string, SiteOrigins, string][])(
    'resolves rssx-lab.wiloon.com by the %s build origins',
    (_, origins, name) => {
      expect(
        resolveSiteAdapter(loc('rssx-lab.wiloon.com', '/'), origins).name
      ).toBe(name)
    }
  )

  it('does not match a lookalike RSSX host', () => {
    expect(
      resolveSiteAdapter(loc('rssx-lab.wiloon.com.evil.net', '/'), HOMELAB).name
    ).toBe('default')
  })

  const rssx = resolveSiteAdapter(loc('rssx-lab.wiloon.com', '/'), HOMELAB)

  it('matches the host that serves the RSSX Reader', () => {
    expect(rssx.name).toBe('rssx')
  })

  // The Reader swaps the open Article in place (router.replace), so learning
  // mode has to re-run on every in-page navigation, as on X.
  it('is an SPA adapter with a readiness selector', () => {
    expect(rssx.contentVolatility).toBe('spa')
    expect(rssx.readySelector).toBeDefined()
  })

  // The Reader renders exactly one <article>: the open one. The feed and
  // article columns are <section>s and stay out of scope.
  it('processes only the open <article>, not the columns around it', () => {
    document.body.innerHTML = `
      <section class="article-column"><div>A long article list row title here</div></section>
      <section class="reading-pane">
        <article><h1>Title</h1><div>Short feed body.</div></article>
      </section>`
    const nodes = WordProcessor.getArticleNodes({
      contentSelector: rssx.contentSelector,
      minTextLength: rssx.minTextLength,
    })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].tagName).toBe('ARTICLE')
  })

  it('finds nothing while the reading pane is empty', () => {
    document.body.innerHTML = `
      <section class="reading-pane"><p>Select an article to read</p></section>`
    expect(document.querySelector(rssx.readySelector!)).toBeNull()
    expect(
      WordProcessor.getArticleNodes({
        contentSelector: rssx.contentSelector,
        minTextLength: rssx.minTextLength,
      })
    ).toEqual([])
  })
})

describe('X adapter readiness selector', () => {
  it('waits for the focused tweet or X Article body', () => {
    const x = resolveSiteAdapter(loc('x.com', '/u/status/1'), HOMELAB)
    expect(x.readySelector).toBe(X_READY_SELECTOR)
  })
})

describe('Wikipedia adapter', () => {
  // Trimmed from en.wikipedia.org/wiki/Cat (2026-10-15): the reference list
  // holds <a class="external text"> links with long titles, and the language
  // menu outside the article names languages in Chinese characters.
  const longTitle =
    'The domestic cat is a small carnivorous mammal kept as a pet, a long reference title from a cited source'
  const renderWikipediaPage = () => {
    document.body.innerHTML = `
      <div class="mw-page-container">
        <div id="p-lang-btn">
          <ul>
            <li><a lang="zh">中文</a></li><li><a lang="yue">粵語</a></li>
            <li><a lang="lzh">文言</a></li><li><a lang="wuu">吴语</a></li>
            <li><a lang="nan">閩南語</a></li><li><a lang="ja">日本語</a></li>
            <li><a lang="hak">客家語</a></li><li><a lang="gan">贛語</a></li>
            <li><a lang="zh-classical">古文漢語</a></li>
          </ul>
        </div>
        <div id="mw-content-text">
          <div class="mw-parser-output">
            <p>The cat is a small domesticated carnivorous mammal. It is the only domesticated species of the family Felidae.</p>
            <ol class="references">
              <li><a class="external text" href="https://example.org/1">${longTitle}</a></li>
              <li><a class="external text" href="https://example.org/2">${longTitle}</a></li>
            </ol>
          </div>
        </div>
      </div>`
  }

  it('matches every Wikipedia language and the mobile site', () => {
    for (const host of [
      'en.wikipedia.org',
      'en.m.wikipedia.org',
      'de.wikipedia.org',
    ]) {
      expect(resolveSiteAdapter(loc(host, '/wiki/Cat'), HOMELAB).name).toBe(
        'wikipedia'
      )
    }
    expect(
      resolveSiteAdapter(loc('wikipedia.org.evil.net', '/'), HOMELAB).name
    ).toBe('default')
  })

  it('processes the article body, not the reference links or the language menu', () => {
    renderWikipediaPage()
    const wikipedia = resolveSiteAdapter(
      loc('en.wikipedia.org', '/wiki/Cat'),
      HOMELAB
    )
    const nodes = WordProcessor.getArticleNodes({
      contentSelector: wikipedia.contentSelector,
      minTextLength: wikipedia.minTextLength,
    })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].className).toBe('mw-parser-output')
    expect(nodes[0].textContent).not.toContain('中文')
  })
})
