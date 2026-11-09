/**
 * @jest-environment node
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  COMMON_SOURCE_PATHS,
  discoverArticles,
  feedLinks,
  isArticleUrl,
  parseFeed,
  parseSitemap,
  robotsSitemaps,
  selectArticles,
  type DiscoveryDeps,
} from '../discovery'

const SITE = 'https://www.blog.example/'

const rss = (items: Array<[string, string?]>) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Blog</title><link>https://www.blog.example/</link>
${items
  .map(
    ([link, date]) =>
      `<item><title>t</title><link>${link}</link>${date ? `<pubDate>${date}</pubDate>` : ''}</item>`
  )
  .join('\n')}
</channel></rss>`

const urlset = (urls: Array<[string, string?]>) => `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ([loc, lastmod]) =>
      `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`
  )
  .join('\n')}
</urlset>`

describe('feedLinks', () => {
  it('finds RSS and Atom alternate links and resolves them against the page', () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/a.css">
      <link rel="alternate" type="application/rss+xml" title="Feed" href="/feed/">
      <link type='application/atom+xml' href='https://cdn.blog.example/atom.xml' rel='alternate'>
      <link rel="alternate" hreflang="de" href="/de/">
    </head></html>`

    expect(feedLinks(html, SITE)).toEqual([
      'https://www.blog.example/feed/',
      'https://cdn.blog.example/atom.xml',
    ])
  })
})

describe('robotsSitemaps', () => {
  it('lists the Sitemap entries in robots.txt', () => {
    const robots = `User-agent: *\nDisallow: /admin\nSitemap: https://www.blog.example/sitemap_index.xml\nsitemap: /news.xml\n`

    expect(robotsSitemaps(robots, SITE)).toEqual([
      'https://www.blog.example/sitemap_index.xml',
      'https://www.blog.example/news.xml',
    ])
  })
})

describe('parseFeed', () => {
  it('reads RSS item links and publication dates', () => {
    expect(
      parseFeed(
        rss([
          [
            'https://www.blog.example/2026/a?x=1&amp;y=2',
            'Fri, 06 Nov 2026 10:00:00 GMT',
          ],
          ['<![CDATA[https://www.blog.example/b?x=1&y=2]]>'],
        ]),
        'https://www.blog.example/feed.xml'
      )
    ).toEqual([
      {
        url: 'https://www.blog.example/2026/a?x=1&y=2',
        date: '2026-11-06T10:00:00.000Z',
      },
      { url: 'https://www.blog.example/b?x=1&y=2', date: null },
    ])
  })

  it('reads Atom entry links and dates', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><link href="https://www.blog.example/"/>
      <entry><title>a</title><link rel="alternate" type="text/html" href="https://www.blog.example/a"/><published>2026-11-01T00:00:00Z</published></entry>
      <entry><link rel="edit" href="https://www.blog.example/edit/b"/><link href="https://www.blog.example/b"/><updated>2026-10-01T00:00:00Z</updated></entry>
    </feed>`

    expect(parseFeed(atom, 'https://www.blog.example/feed.xml')).toEqual([
      { url: 'https://www.blog.example/a', date: '2026-11-01T00:00:00.000Z' },
      { url: 'https://www.blog.example/b', date: '2026-10-01T00:00:00.000Z' },
    ])
  })
})

describe('parseFeed edge cases', () => {
  const base = 'https://www.blog.example/feed.xml'

  it('resolves relative Atom and RSS links against the feed URL', () => {
    const atom = '<feed><entry><link href="/posts/x"/></entry></feed>'
    const rssFeed =
      '<rss><channel><item><link>/posts/y</link></item></channel></rss>'

    expect(parseFeed(atom, base)).toEqual([
      { url: 'https://www.blog.example/posts/x', date: null },
    ])
    expect(parseFeed(rssFeed, base)).toEqual([
      { url: 'https://www.blog.example/posts/y', date: null },
    ])
  })

  it('keeps an out-of-range numeric entity instead of throwing', () => {
    const feed =
      '<rss><item><link>https://www.blog.example/a?q=&#x110000;&#99999999;</link></item></rss>'

    expect(() => parseFeed(feed, base)).not.toThrow()
  })
})

describe('parseSitemap', () => {
  it('reads a urlset with lastmod', () => {
    expect(
      parseSitemap(
        urlset([
          ['https://www.blog.example/a', '2026-11-02'],
          ['https://www.blog.example/b'],
        ])
      )
    ).toEqual({
      sitemaps: [],
      urls: [
        { url: 'https://www.blog.example/a', date: '2026-11-02T00:00:00.000Z' },
        { url: 'https://www.blog.example/b', date: null },
      ],
    })
  })

  it('reads the child sitemaps of a sitemap index', () => {
    const index = `<sitemapindex><sitemap><loc>https://www.blog.example/post-sitemap.xml</loc><lastmod>2026-11-06</lastmod></sitemap></sitemapindex>`

    expect(parseSitemap(index)).toEqual({
      sitemaps: [
        {
          url: 'https://www.blog.example/post-sitemap.xml',
          date: '2026-11-06T00:00:00.000Z',
        },
      ],
      urls: [],
    })
  })
})

describe('isArticleUrl', () => {
  it.each([
    ['https://www.blog.example/2026/11/a-post/', true],
    ['https://blog.example/a-post', true],
    ['https://news.blog.example/a-post', true],
    ['https://www.blog.example/', false],
    ['https://www.blog.example/index.html', false],
    ['https://www.blog.example/tag/go/', false],
    ['https://www.blog.example/category/news', false],
    ['https://www.blog.example/author/jane', false],
    ['https://www.blog.example/page/2/', false],
    ['https://www.blog.example/topics/science', false],
    ['https://www.blog.example/about', false],
    ['https://www.blog.example/feed/', false],
    ['https://www.blog.example/post-sitemap.xml', false],
    ['https://www.blog.example/cover.jpg', false],
    ['https://other.example/a-post', false],
    ['mailto:a@blog.example', false],
  ])('%s is an article: %s', (url, expected) => {
    expect(isArticleUrl(url, SITE)).toBe(expected)
  })
})

describe('selectArticles', () => {
  it('puts the newest dated items first and undated ones after, in source order', () => {
    const selected = selectArticles(
      [
        { url: 'https://www.blog.example/undated-1', date: null },
        {
          url: 'https://www.blog.example/old',
          date: '2026-01-01T00:00:00.000Z',
        },
        { url: 'https://www.blog.example/undated-2', date: null },
        {
          url: 'https://www.blog.example/new',
          date: '2026-11-01T00:00:00.000Z',
        },
      ],
      SITE
    )

    expect(selected.map(item => item.url)).toEqual([
      'https://www.blog.example/new',
      'https://www.blog.example/old',
      'https://www.blog.example/undated-1',
      'https://www.blog.example/undated-2',
    ])
  })

  it('drops non-article pages and duplicate URLs', () => {
    const selected = selectArticles(
      [
        {
          url: 'https://www.blog.example/tag/x',
          date: '2026-11-05T00:00:00.000Z',
        },
        { url: 'https://www.blog.example/a', date: '2026-11-01T00:00:00.000Z' },
        {
          url: 'https://www.blog.example/a#comments',
          date: '2026-11-02T00:00:00.000Z',
        },
        { url: 'https://www.blog.example/', date: null },
      ],
      SITE
    )

    expect(selected).toEqual([
      { url: 'https://www.blog.example/a', date: '2026-11-02T00:00:00.000Z' },
    ])
  })
})

interface FakeResponse {
  status?: number
  body?: string | Uint8Array
  redirect?: string
}

function fakeDeps(responses: Record<string, FakeResponse>) {
  const requested: string[] = []
  const deps: DiscoveryDeps = {
    async fetch(url) {
      requested.push(url)
      const response = responses[url]
      if (!response) return { status: 404, url, body: new Uint8Array() }
      if (response.status === 0) throw new Error('timed out')
      const body =
        typeof response.body === 'string'
          ? new TextEncoder().encode(response.body)
          : (response.body ?? new Uint8Array())
      return {
        status: response.status ?? 200,
        url: response.redirect ?? url,
        body,
      }
    },
    gunzip: bytes => new Uint8Array(gunzipSync(bytes)),
  }
  return { deps, requested }
}

const ok: FakeResponse = { body: '<html>article</html>' }

describe('discoverArticles', () => {
  it('resolves a relative homepage feed link against the final URL after a redirect', async () => {
    const { deps } = fakeDeps({
      [SITE]: {
        redirect: 'https://www.blog.example/en/',
        body: '<link rel="alternate" type="application/rss+xml" href="feed.xml">',
      },
      'https://www.blog.example/en/feed.xml': {
        body: rss([
          ['https://www.blog.example/en/post', 'Fri, 06 Nov 2026 10:00:00 GMT'],
        ]),
      },
      'https://www.blog.example/en/post': ok,
    })

    const result = await discoverArticles(SITE, deps, { wanted: 1 })

    expect(result.candidates).toEqual([
      {
        url: 'https://www.blog.example/en/post',
        date: '2026-11-06T10:00:00.000Z',
        source: 'https://www.blog.example/en/feed.xml',
      },
    ])
  })

  it('resolves relative feed links against the final URL after a redirect', async () => {
    const { deps } = fakeDeps({
      [SITE]: {
        body: '<link rel="alternate" type="application/rss+xml" href="/feed">',
      },
      'https://www.blog.example/feed': {
        redirect: 'https://www.blog.example/blog/feed.xml',
        body: rss([['post', 'Fri, 06 Nov 2026 10:00:00 GMT']]),
      },
      'https://www.blog.example/blog/post': ok,
    })

    const result = await discoverArticles(SITE, deps, { wanted: 1 })

    expect(result.candidates).toEqual([
      {
        url: 'https://www.blog.example/blog/post',
        date: '2026-11-06T10:00:00.000Z',
        source: 'https://www.blog.example/feed',
      },
    ])
  })

  it('prefers the homepage feed over sitemaps and stops at two articles', async () => {
    const { deps, requested } = fakeDeps({
      [SITE]: {
        body: '<link rel="alternate" type="application/rss+xml" href="/feed/">',
      },
      'https://www.blog.example/feed/': {
        body: rss([
          ['https://www.blog.example/a', 'Fri, 06 Nov 2026 10:00:00 GMT'],
          ['https://www.blog.example/b', 'Thu, 05 Nov 2026 10:00:00 GMT'],
          ['https://www.blog.example/c', 'Sat, 07 Nov 2026 10:00:00 GMT'],
        ]),
      },
      'https://www.blog.example/a': ok,
      'https://www.blog.example/c': ok,
    })

    const result = await discoverArticles(SITE, deps)

    expect(result.candidates).toEqual([
      {
        url: 'https://www.blog.example/c',
        date: '2026-11-07T10:00:00.000Z',
        source: 'https://www.blog.example/feed/',
      },
      {
        url: 'https://www.blog.example/a',
        date: '2026-11-06T10:00:00.000Z',
        source: 'https://www.blog.example/feed/',
      },
    ])
    expect(requested).not.toContain('https://www.blog.example/robots.txt')
  })

  it('passes over skipped URLs, so a page that failed screening can be replaced', async () => {
    const { deps, requested } = fakeDeps({
      [SITE]: {
        body: '<link rel="alternate" type="application/rss+xml" href="/feed/">',
      },
      'https://www.blog.example/feed/': {
        body: rss([
          ['https://www.blog.example/a', 'Sat, 07 Nov 2026 10:00:00 GMT'],
          ['https://www.blog.example/b', 'Fri, 06 Nov 2026 10:00:00 GMT'],
          ['https://www.blog.example/c', 'Thu, 05 Nov 2026 10:00:00 GMT'],
        ]),
      },
      'https://www.blog.example/a': ok,
      'https://www.blog.example/b': ok,
      'https://www.blog.example/c': ok,
    })

    const result = await discoverArticles(SITE, deps, {}, [
      'https://www.blog.example/a',
    ])

    expect(result.candidates.map(c => c.url)).toEqual([
      'https://www.blog.example/b',
      'https://www.blog.example/c',
    ])
    expect(requested).not.toContain('https://www.blog.example/a')
  })

  it('skips candidates whose final response is not 2xx, and reports them', async () => {
    const { deps } = fakeDeps({
      [SITE]: {
        body: '<link rel="alternate" type="application/atom+xml" href="/atom.xml">',
      },
      'https://www.blog.example/atom.xml': {
        body: `<feed>
          <entry><link href="https://www.blog.example/gone"/><updated>2026-11-07T00:00:00Z</updated></entry>
          <entry><link href="https://www.blog.example/moved"/><updated>2026-11-06T00:00:00Z</updated></entry>
          <entry><link href="https://www.blog.example/a"/><updated>2026-11-05T00:00:00Z</updated></entry>
          <entry><link href="https://www.blog.example/b"/><updated>2026-11-04T00:00:00Z</updated></entry>
        </feed>`,
      },
      'https://www.blog.example/gone': { status: 410 },
      'https://www.blog.example/moved': { redirect: SITE, body: 'home' },
      'https://www.blog.example/a': ok,
      'https://www.blog.example/b': ok,
    })

    const result = await discoverArticles(SITE, deps)

    expect(result.candidates.map(c => c.url)).toEqual([
      'https://www.blog.example/a',
      'https://www.blog.example/b',
    ])
    expect(result.failures).toEqual([
      { url: 'https://www.blog.example/gone', error: 'HTTP 410' },
      {
        url: 'https://www.blog.example/moved',
        error: `redirected to a non-article page: ${SITE}`,
      },
    ])
  })

  it('falls back to robots.txt sitemaps, following an index into a gzipped sitemap', async () => {
    const { deps } = fakeDeps({
      [SITE]: { body: '<html>no feed</html>' },
      'https://www.blog.example/robots.txt': {
        body: 'Sitemap: https://www.blog.example/sitemap_index.xml',
      },
      'https://www.blog.example/sitemap_index.xml': {
        body: `<sitemapindex>
          <sitemap><loc>https://www.blog.example/old.xml.gz</loc><lastmod>2020-01-01</lastmod></sitemap>
          <sitemap><loc>https://www.blog.example/new.xml.gz</loc><lastmod>2026-11-07</lastmod></sitemap>
        </sitemapindex>`,
      },
      'https://www.blog.example/new.xml.gz': {
        body: gzipSync(
          urlset([
            ['https://www.blog.example/n1', '2026-11-07'],
            ['https://www.blog.example/n2', '2026-11-06'],
          ])
        ),
      },
      'https://www.blog.example/old.xml.gz': {
        body: gzipSync(urlset([['https://www.blog.example/o1', '2020-01-01']])),
      },
      'https://www.blog.example/n1': ok,
      'https://www.blog.example/n2': ok,
    })

    const result = await discoverArticles(SITE, deps)

    expect(result.candidates).toEqual([
      {
        url: 'https://www.blog.example/n1',
        date: '2026-11-07T00:00:00.000Z',
        source: 'https://www.blog.example/sitemap_index.xml',
      },
      {
        url: 'https://www.blog.example/n2',
        date: '2026-11-06T00:00:00.000Z',
        source: 'https://www.blog.example/sitemap_index.xml',
      },
    ])
  })

  it('tries the common feed paths last, and continues past a source with too few articles', async () => {
    const { deps } = fakeDeps({
      [SITE]: { body: '<html></html>' },
      'https://www.blog.example/robots.txt': {
        body: 'Sitemap: https://www.blog.example/sitemap.xml',
      },
      'https://www.blog.example/sitemap.xml': {
        body: urlset([['https://www.blog.example/s1', '2026-11-01']]),
      },
      'https://www.blog.example/feed': {
        body: rss([
          ['https://www.blog.example/s1', 'Sun, 01 Nov 2026 00:00:00 GMT'],
          ['https://www.blog.example/f1', 'Sat, 31 Oct 2026 00:00:00 GMT'],
        ]),
      },
      'https://www.blog.example/s1': ok,
      'https://www.blog.example/f1': ok,
    })

    const result = await discoverArticles(SITE, deps)

    expect(result.candidates.map(c => [c.url, c.source])).toEqual([
      ['https://www.blog.example/s1', 'https://www.blog.example/sitemap.xml'],
      ['https://www.blog.example/f1', 'https://www.blog.example/feed'],
    ])
  })

  it('reports every failed source when it cannot find two articles', async () => {
    const { deps, requested } = fakeDeps({
      [SITE]: { status: 0 },
      'https://www.blog.example/robots.txt': { status: 403 },
      'https://www.blog.example/feed': {
        body: rss([
          ['https://www.blog.example/only', 'Sun, 01 Nov 2026 00:00:00 GMT'],
        ]),
      },
      'https://www.blog.example/only': ok,
    })

    const result = await discoverArticles(SITE, deps)

    expect(result.candidates.map(c => c.url)).toEqual([
      'https://www.blog.example/only',
    ])
    expect(result.failures).toEqual(
      expect.arrayContaining([
        { url: SITE, error: 'timed out' },
        { url: 'https://www.blog.example/robots.txt', error: 'HTTP 403' },
        { url: 'https://www.blog.example/sitemap.xml', error: 'HTTP 404' },
      ])
    )
    expect(result.failures.at(-1)).toEqual({
      url: SITE,
      error: 'found 1 of 2 articles',
    })
    expect(new Set(requested).size).toBe(requested.length)
  })

  it('stops at the request budget so a huge site cannot run forever', async () => {
    const children = Array.from(
      { length: 50 },
      (_, i) =>
        `<sitemap><loc>https://www.blog.example/s${i}.xml</loc></sitemap>`
    ).join('')
    const { deps, requested } = fakeDeps({
      [SITE]: { body: '' },
      'https://www.blog.example/robots.txt': {
        body: 'Sitemap: https://www.blog.example/index.xml',
      },
      'https://www.blog.example/index.xml': {
        body: `<sitemapindex>${children}</sitemapindex>`,
      },
    })

    const result = await discoverArticles(SITE, deps, { maxRequests: 10 })

    expect(requested).toHaveLength(10)
    expect(result.candidates).toEqual([])
    expect(result.failures).toContainEqual({
      url: SITE,
      error: 'stopped after 10 requests',
    })
  })

  it('reaches the eligible URLs of a child sitemap too large to spread into a call', async () => {
    const urls = Array.from(
      { length: 200_000 },
      (_, i) => `<url><loc>https://www.blog.example/p${i}</loc></url>`
    ).join('')
    const { deps } = fakeDeps({
      [SITE]: { body: '' },
      'https://www.blog.example/robots.txt': {
        body: 'Sitemap: https://www.blog.example/index.xml',
      },
      'https://www.blog.example/index.xml': {
        body: '<sitemapindex><sitemap><loc>https://www.blog.example/huge.xml</loc></sitemap></sitemapindex>',
      },
      'https://www.blog.example/huge.xml': { body: `<urlset>${urls}</urlset>` },
      'https://www.blog.example/p0': ok,
      'https://www.blog.example/p1': ok,
    })

    const result = await discoverArticles(SITE, deps)

    expect(result.candidates.map(c => c.url)).toEqual([
      'https://www.blog.example/p0',
      'https://www.blog.example/p1',
    ])
    expect(result.failures).toEqual([])
  })
})

describe('discoverArticles on a homepage with a path', () => {
  const DOCS = 'https://docs.example/uv/'
  const commonUnder = (base: string) =>
    COMMON_SOURCE_PATHS.map(path => new URL(path.slice(1), base).href)
  const commonAtRoot = (base: string) =>
    COMMON_SOURCE_PATHS.map(path => new URL(path, base).href)

  it('tries the common paths under the homepage path before the root, skipping the homepage itself', async () => {
    const { deps, requested } = fakeDeps({
      [DOCS]: { body: '<html>docs</html>' },
      'https://docs.example/uv/sitemap.xml': {
        body: urlset([
          ['https://docs.example/uv/'],
          ['https://docs.example/uv'],
          ['https://docs.example/uv/#top'],
          ['https://docs.example/uv/guides/install/'],
          ['https://docs.example/ruff/rules/'],
        ]),
      },
      'https://docs.example/uv': ok,
      'https://docs.example/uv/guides/install/': ok,
      'https://docs.example/ruff/rules/': ok,
    })

    const result = await discoverArticles(DOCS, deps)

    expect(result.candidates.map(c => [c.url, c.source])).toEqual([
      [
        'https://docs.example/uv/guides/install/',
        'https://docs.example/uv/sitemap.xml',
      ],
      [
        'https://docs.example/ruff/rules/',
        'https://docs.example/uv/sitemap.xml',
      ],
    ])
    expect(requested).not.toContain('https://docs.example/uv')
    expect(requested.slice(0, 2)).toEqual([
      DOCS,
      'https://docs.example/robots.txt',
    ])
    expect(requested.slice(2, 9)).toEqual(commonUnder(DOCS).slice(0, 7))
  })

  it('reads a path without a trailing slash as a directory', async () => {
    const { deps, requested } = fakeDeps({})

    await discoverArticles('https://docs.example/uv', deps)

    expect(requested).toEqual([
      'https://docs.example/uv',
      'https://docs.example/robots.txt',
      ...commonUnder(DOCS),
      ...commonAtRoot(DOCS),
    ])
  })

  it('uses the final homepage URL after a redirect, and skips pages that redirect to either homepage', async () => {
    const { deps, requested } = fakeDeps({
      'https://docs.example/': { redirect: 'https://docs.example/en/latest' },
      'https://docs.example/en/latest/feed.xml': {
        body: rss([
          ['https://docs.example/latest', 'Sat, 07 Nov 2026 00:00:00 GMT'],
          ['https://docs.example/en/latest/', 'Fri, 06 Nov 2026 00:00:00 GMT'],
          ['https://docs.example/start', 'Thu, 05 Nov 2026 00:00:00 GMT'],
          ['https://docs.example/en/latest/a', 'Wed, 04 Nov 2026 00:00:00 GMT'],
          ['https://docs.example/en/latest/b', 'Tue, 03 Nov 2026 00:00:00 GMT'],
        ]),
      },
      'https://docs.example/start': { redirect: 'https://docs.example/#intro' },
      'https://docs.example/latest': {
        redirect: 'https://docs.example/en/latest/',
      },
      'https://docs.example/en/latest/a': ok,
      'https://docs.example/en/latest/b': ok,
    })

    const result = await discoverArticles('https://docs.example/', deps)

    expect(result.candidates.map(c => c.url)).toEqual([
      'https://docs.example/en/latest/a',
      'https://docs.example/en/latest/b',
    ])
    expect(requested).not.toContain('https://docs.example/en/latest/')
    expect(
      result.failures.filter(f => f.error.startsWith('redirected'))
    ).toEqual([
      {
        url: 'https://docs.example/latest',
        error:
          'redirected to a non-article page: https://docs.example/en/latest/',
      },
      {
        url: 'https://docs.example/start',
        error: 'redirected to a non-article page: https://docs.example/#intro',
      },
    ])
  })

  it('falls back to the input path when the homepage cannot be fetched', async () => {
    const { deps, requested } = fakeDeps({ [DOCS]: { status: 0 } })

    await discoverArticles(DOCS, deps)

    expect(requested).toEqual([
      DOCS,
      'https://docs.example/robots.txt',
      ...commonUnder(DOCS),
      ...commonAtRoot(DOCS),
    ])
  })

  it('requests the same sources as before for a root homepage', async () => {
    const { deps, requested } = fakeDeps({ [SITE]: { body: '' } })

    await discoverArticles(SITE, deps)

    expect(requested).toEqual([
      SITE,
      'https://www.blog.example/robots.txt',
      ...commonAtRoot(SITE),
    ])
  })
})
