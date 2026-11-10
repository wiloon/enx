import { Readability } from '@mozilla/readability'
import { resolveLookupArea } from '@/lib/lookupArea'
import { DEFAULT_ADAPTER, lookupAreaOptions } from '@/lib/siteAdapters'

// English prose exactly `length` characters long.
function prose(length: number): string {
  const sentence = 'The reader turns another page of the long story. '
  return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length)
}

function paragraphs(count: number, length: number): string {
  return Array.from({ length: count }, () => `<p>${prose(length)}</p>`).join('')
}

function jsonLd(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`
}

// A news page no selector recognises: nav, the story in a plain div, a footer.
function newsPage(head: string): void {
  document.head.innerHTML = head
  document.body.innerHTML = `
    <div class="site-nav"><a href="/a">Home</a> <a href="/b">World</a></div>
    <div id="story" class="story-body">${paragraphs(6, 400)}</div>
    <div class="site-footer"><a href="/c">About</a></div>`
}

const realReadability = () => Promise.resolve(Readability)

describe('resolveLookupArea layer 6 (ADR-077)', () => {
  afterEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('takes the Readability node when the page declares a NewsArticle and no selector matches', async () => {
    newsPage(jsonLd({ '@context': 'https://schema.org', '@type': 'NewsArticle' }))

    const area = await resolveLookupArea(lookupAreaOptions(DEFAULT_ADAPTER), {
      loadReadability: realReadability,
    })

    expect(area.source).toBe('article')
    expect(area.nodes).toEqual([document.getElementById('story')])
    expect(area.fallback).toBe('json-ld-readability')
  })

  it.each([
    ['TechArticle', { '@type': 'TechArticle' }],
    ['BlogPosting', { '@type': 'BlogPosting' }],
    ['LiveBlogPosting', { '@type': 'LiveBlogPosting' }],
    ['APIReference', { '@type': 'APIReference' }],
    ['an @type array', { '@type': ['WebPage', 'Article'] }],
    [
      'an Article inside @graph',
      { '@graph': [{ '@type': 'WebSite' }, { '@type': 'Article' }] },
    ],
    [
      'an Article as mainEntity',
      { '@type': 'WebPage', mainEntity: { '@type': 'NewsArticle' } },
    ],
    [
      'an Article as mainEntityOfPage',
      { '@type': 'WebPage', mainEntityOfPage: { '@type': 'BlogPosting' } },
    ],
    ['a top-level array', [{ '@type': 'Organization' }, { '@type': 'Article' }]],
  ])('passes the gate for %s', async (_case, data) => {
    newsPage(jsonLd(data))

    const area = await resolveLookupArea(lookupAreaOptions(DEFAULT_ADAPTER), {
      loadReadability: realReadability,
    })

    expect(area.nodes).toEqual([document.getElementById('story')])
    expect(area.fallback).toBe('json-ld-readability')
  })

  it.each([
    ['only a WebSite', jsonLd({ '@type': 'WebSite' })],
    ['only og:type=article', '<meta property="og:type" content="article">'],
    ['no JSON-LD', ''],
    [
      'articles listed under hasPart',
      jsonLd({ '@type': 'CollectionPage', hasPart: [{ '@type': 'Article' }] }),
    ],
    [
      'malformed JSON-LD',
      '<script type="application/ld+json">{"@type": "Article",</script>',
    ],
  ])(
    'stays on the whole page without loading Readability for %s',
    async (_case, head) => {
      newsPage(head)
      const loadReadability = jest.fn(realReadability)

      const area = await resolveLookupArea(
        lookupAreaOptions(DEFAULT_ADAPTER),
        { loadReadability }
      )

      expect(area).toEqual({ nodes: [document.body], source: 'whole-page' })
      expect(loadReadability).not.toHaveBeenCalled()
    }
  )

  describe('node conditions', () => {
    const article = jsonLd({ '@type': 'Article' })
    const resolve = () =>
      resolveLookupArea(lookupAreaOptions(DEFAULT_ADAPTER), {
        loadReadability: realReadability,
      })
    const WHOLE_PAGE = () => ({ nodes: [document.body], source: 'whole-page' })

    it('stays on the whole page when the node has under 500 characters', async () => {
      document.head.innerHTML = article
      document.body.innerHTML = `
        <div class="site-nav"><a href="/a">Home</a></div>
        <div id="story">${paragraphs(2, 240)}</div>`

      expect(await resolve()).toEqual(WHOLE_PAGE())
    })

    it('does not count script text toward the 500 characters', async () => {
      document.head.innerHTML = article
      document.body.innerHTML = `
        <div class="site-nav"><a href="/a">Home</a></div>
        <div id="story">${paragraphs(2, 200)}<script>var x = "${prose(900)}"</script></div>`

      expect(await resolve()).toEqual(WHOLE_PAGE())
    })

    it('stays on the whole page when the node has link density above 0.2', async () => {
      const linkList = Array.from(
        { length: 12 },
        (_, i) => `<li><a href="/r${i}">${prose(60)}</a></li>`
      ).join('')
      document.head.innerHTML = article
      document.body.innerHTML = `
        <div class="site-nav"><a href="/a">Home</a></div>
        <div id="story">${paragraphs(4, 400)}<ul>${linkList}</ul></div>`

      expect(await resolve()).toEqual(WHOLE_PAGE())
    })

    it('takes a node at link density 0.2 or below', async () => {
      const linkList = Array.from(
        { length: 4 },
        (_, i) => `<li><a href="/r${i}">${prose(60)}</a></li>`
      ).join('')
      document.head.innerHTML = article
      document.body.innerHTML = `
        <div class="site-nav"><a href="/a">Home</a></div>
        <div id="story">${paragraphs(4, 400)}<ul>${linkList}</ul></div>`

      expect((await resolve()).nodes).toEqual([
        document.getElementById('story'),
      ])
    })

    it('stays on the whole page when the mapped node is the body', async () => {
      document.head.innerHTML = article
      document.body.innerHTML = paragraphs(6, 400)

      expect(await resolve()).toEqual(WHOLE_PAGE())
    })
  })

  describe('when layer 6 does not run', () => {
    it('leaves an adapter with a contentSelector that falls back to the whole page alone', async () => {
      newsPage(jsonLd({ '@type': 'Article' }))
      const loadReadability = jest.fn(realReadability)

      const area = await resolveLookupArea(
        { contentSelector: '.adapter-body', wholePageOnMiss: true },
        { loadReadability }
      )

      expect(area).toEqual({ nodes: [document.body], source: 'whole-page' })
      expect(loadReadability).not.toHaveBeenCalled()
    })

    it('keeps a selector match without loading Readability', async () => {
      document.head.innerHTML = jsonLd({ '@type': 'Article' })
      document.body.innerHTML = `<article id="tagged">${paragraphs(3, 400)}</article>`
      const loadReadability = jest.fn(realReadability)

      const area = await resolveLookupArea(lookupAreaOptions(DEFAULT_ADAPTER), {
        loadReadability,
      })

      expect(area.nodes).toEqual([document.getElementById('tagged')])
      expect(area.fallback).toBeUndefined()
      expect(loadReadability).not.toHaveBeenCalled()
    })
  })

  it('falls back to the whole page when Readability fails to load', async () => {
    newsPage(jsonLd({ '@type': 'Article' }))

    const area = await resolveLookupArea(lookupAreaOptions(DEFAULT_ADAPTER), {
      loadReadability: () => Promise.reject(new Error('chunk load failed')),
    })

    expect(area).toEqual({ nodes: [document.body], source: 'whole-page' })
  })

  it('leaves the page unchanged', async () => {
    newsPage(jsonLd({ '@type': 'Article' }))
    const before = document.documentElement.outerHTML

    await resolveLookupArea(lookupAreaOptions(DEFAULT_ADAPTER), {
      loadReadability: realReadability,
    })

    expect(document.documentElement.outerHTML).toBe(before)
  })

  it('skips a malformed JSON-LD block and reads the next one', async () => {
    newsPage(
      '<script type="application/ld+json">{oops</script>' +
        jsonLd({ '@type': 'Article' })
    )

    const area = await resolveLookupArea(lookupAreaOptions(DEFAULT_ADAPTER), {
      loadReadability: realReadability,
    })

    expect(area.nodes).toEqual([document.getElementById('story')])
  })
})
