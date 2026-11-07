import { DEFAULT_ADAPTER } from '@/lib/siteAdapters'
import { WordProcessor } from '@/lib/wordProcessor'

// English prose exactly `length` characters long.
function prose(length: number): string {
  const sentence = 'The reader turns another page of the long story. '
  return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length)
}

// `count` links of `length` characters each, back to back.
function links(count: number, length: number): string {
  return Array.from(
    { length: count },
    (_, i) => `<a href="/l${i}">${prose(length)}</a>`
  ).join('')
}

// What processArticleContent passes for a site with no adapter.
function getArticleNodesAsDefaultSite(): Element[] {
  return WordProcessor.getArticleNodes({
    contentSelector: DEFAULT_ADAPTER.contentSelector,
    minTextLength: DEFAULT_ADAPTER.minTextLength,
    focusedNodeResolver: DEFAULT_ADAPTER.focusedNodeResolver,
  })
}

function lookupAreaAsDefaultSite() {
  return WordProcessor.findLookupArea({
    contentSelector: DEFAULT_ADAPTER.contentSelector,
    minTextLength: DEFAULT_ADAPTER.minTextLength,
    focusedNodeResolver: DEFAULT_ADAPTER.focusedNodeResolver,
  })
}

// No selector match: the whole body is the lookup area.
const WHOLE_PAGE = () => ({ nodes: [document.body], source: 'whole-page' })

// One simplified page shape per row (adr-034, 2026-11-07): a selector match
// is the article, anything else is the whole page. `expected` is a selector
// for the one element returned.
describe('WordProcessor.findLookupArea page shapes', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const rows: Array<{
    shape: string
    html: string
    expected: string
    source: 'article' | 'whole-page'
    selector?: string
  }> = [
    {
      shape: 'an article element',
      html: `
          <div id="nav">${links(5, 20)}</div>
          <article id="story"><p>${prose(800)}</p></article>
          <footer>${prose(200)}</footer>`,
      expected: '#story',
      source: 'article',
      selector: 'article',
    },
    {
      shape: 'a generic .entry-content class',
      html: `
          <div id="page">
            <h1>Post title</h1>
            <div class="entry-content"><p>${prose(900)}</p></div>
            <div id="sidebar"><p>${prose(300)}</p></div>
          </div>`,
      expected: '.entry-content',
      source: 'article',
      selector: '.entry-content',
    },
    {
      shape: 'a #root wrapper around the whole page, the whole page',
      html: `
          <div id="root">
            <div id="header">${links(4, 15)}</div>
            <div id="body-text"><p>${prose(700)}</p><p>${prose(700)}</p></div>
            <div id="footer"><p>${prose(150)}</p></div>
          </div>`,
      expected: 'body',
      source: 'whole-page',
    },
    {
      shape: 'a home page whose main holds most of the text, the whole page',
      html: `
          <header><div id="menu">${links(6, 12)}</div></header>
          <main id="home">
            <div class="card"><p>${prose(600)}</p></div>
            <div class="card"><p>${prose(600)}</p></div>
            <div class="card"><p>${prose(600)}</p></div>
          </main>
          <footer><p>${prose(200)}</p></footer>`,
      expected: 'body',
      source: 'whole-page',
    },
    {
      shape: 'a Standard Ebooks title page in main, the whole page',
      html: `
          <header><nav><ul><li><a href="/">Standard Ebooks</a></li><li><a href="/ebooks">Ebooks</a></li></ul></nav></header>
          <main>
            <section id="titlepage">
              <h1>Short Fiction</h1>
              <p>By <b>Joseph Conrad</b>.</p>
            </section>
          </main>
          <footer><a href="/about">About</a></footer>`,
      expected: 'body',
      source: 'whole-page',
    },
    {
      shape: 'a long navigation beside unmarked prose, the whole page',
      html: `
          <div id="navigation">${links(60, 30)}</div>
          <div id="story"><p>${prose(1200)}</p></div>`,
      expected: 'body',
      source: 'whole-page',
    },
    {
      shape: 'a docs page with div.document, the whole page',
      html: `
          <div class="related">${links(5, 15)}</div>
          <div class="document">
            <div class="documentwrapper">
              <div class="bodywrapper">
                <div class="body" role="main"><p>${prose(1500)}</p></div>
              </div>
            </div>
          </div>
          <div class="sphinxsidebar">${links(20, 25)}</div>`,
      expected: 'body',
      source: 'whole-page',
    },
    {
      shape: 'paragraphs directly under body (#565 shape), the whole page',
      html: `<h1>An Essay</h1><p>${prose(2000)}</p><p>${prose(2000)}</p>`,
      expected: 'body',
      source: 'whole-page',
    },
    {
      shape: 'a list page of mostly links (Hacker News shape), the whole page',
      // Compact markup, as HN serves it: indentation whitespace would
      // count as non-link text.
      html: `<center><table id="hnmain">${Array.from(
        { length: 30 },
        (_, i) =>
          `<tr><td><a href="/item${i}">${prose(60)}</a></td></tr>` +
          `<tr><td>${i} points by <a href="/user${i}">someuser</a> ` +
          `3 hours ago | <a href="/hide${i}">hide</a> | ` +
          `<a href="/item${i}">45 comments</a></td></tr>`
      ).join('')}</table></center>`,
      expected: 'body',
      source: 'whole-page',
    },
    {
      shape: 'a short title page with no container, the whole page',
      html: `<h1>A Short Title</h1><p>${prose(120)}</p>`,
      expected: 'body',
      source: 'whole-page',
    },
  ]

  it.each(rows)('$shape', ({ html, expected, source, selector }) => {
    document.body.innerHTML = html

    expect(lookupAreaAsDefaultSite()).toEqual({
      nodes: [document.querySelector(expected)],
      source,
      selector,
    })
  })
})

describe('WordProcessor.findLookupArea edge cases', () => {
  afterEach(() => {
    if (!document.body) {
      document.documentElement.appendChild(document.createElement('body'))
    }
    document.body.innerHTML = ''
  })

  it('returns [] for a document with no body', () => {
    document.body.remove()
    expect(document.body).toBeNull()

    expect(getArticleNodesAsDefaultSite()).toEqual([])
  })

  it('keeps a selector match even when it holds a small share of the body text', () => {
    document.body.innerHTML = `<p>${prose(5000)}</p><article id="teaser"><p>${prose(200)}</p></article>`

    expect(lookupAreaAsDefaultSite()).toEqual({
      nodes: [document.getElementById('teaser')],
      source: 'article',
      selector: 'article',
    })
  })

  it("returns an adapter's contentSelector match even when it holds a small share of the body text", () => {
    document.body.innerHTML = `<p>${prose(5000)}</p><div class="tweet">${prose(200)}</div>`

    const nodes = WordProcessor.getArticleNodes({
      contentSelector: '.tweet',
      minTextLength: 1,
    })

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toBe(document.querySelector('.tweet'))
  })

  it("names the adapter's contentSelector as the selector that found the article", () => {
    document.body.innerHTML = `<div class="tweet">${prose(200)}</div>`

    expect(
      WordProcessor.findLookupArea({
        contentSelector: '.tweet',
        minTextLength: 1,
      })
    ).toEqual({
      nodes: [document.querySelector('.tweet')],
      source: 'article',
      selector: '.tweet',
    })
  })

  it("returns [] when an adapter's contentSelector matches nothing, without falling back to body", () => {
    document.body.innerHTML = `<p>${prose(5000)}</p>`

    expect(
      WordProcessor.getArticleNodes({
        contentSelector: '.missing',
        minTextLength: 1,
      })
    ).toEqual([])
  })
})

describe('WordProcessor.getArticleNodes', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('should return every element matching the winning selector, not just the longest one', () => {
    // Mirrors the real claude.com/blog page structure: no <article> tag,
    // .blog_post_content_wrap appears twice — a short intro paragraph
    // first, then the real (much longer) article body further down,
    // prefixed by a "Get Claude Code" download CTA. Both should be
    // processed so word lookup works across the whole article, not just
    // whichever block happens to be longest.
    document.body.innerHTML = `
      <main id="main" class="page_main">
        <div class="blog_post_content_wrap">
          <p>Not all tasks require complex loops; start with the simplest solution and use these patterns selectively, adapting the approach to the size and shape of the task at hand.</p>
        </div>
        <div class="blog_post_content_wrap">
          <p>Get Claude Code Desktop VS Code JetBrains</p>
          <p>${'Triggered by a user prompt, Claude repeats cycles of work. '.repeat(10)}</p>
        </div>
      </main>
    `

    const nodes = WordProcessor.getArticleNodes()

    expect(nodes).toHaveLength(2)
    const combinedText = nodes.map(n => n.textContent).join(' ')
    expect(combinedText).toContain('start with the simplest solution')
    expect(combinedText).toContain('Triggered by a user prompt')
  })

  it('should exclude a match nested inside another match', () => {
    document.body.innerHTML = `
      <div class="content">
        <p>${'Outer article content that is long enough to pass the threshold. '.repeat(5)}</p>
        <div class="content">
          <p>${'Inner nested content that would duplicate the outer text. '.repeat(5)}</p>
        </div>
      </div>
    `

    const nodes = WordProcessor.getArticleNodes()

    expect(nodes).toHaveLength(1)
  })

  it('does not take links styled class="text" for the article', () => {
    // Wikipedia's references are <a class="external text">; a long title
    // used to win over the real article body.
    document.body.innerHTML = `
      <div id="body">
        <p>${'Article prose with enough text to pass the length threshold. '.repeat(10)}</p>
        <a class="external text" href="/ref">${'A long cited source title. '.repeat(5)}</a>
      </div>
    `

    expect(WordProcessor.findLookupArea()).toEqual(WHOLE_PAGE())
  })
})

// #563: precise selectors (site-specific, article) count however short the
// match; broad class selectors keep the minimum and pick the longest.
describe('WordProcessor.getArticleNodes precise and broad selectors', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns an article under 100 characters', () => {
    document.body.innerHTML = `<article id="short">${prose(60)}</article>`

    expect(lookupAreaAsDefaultSite()).toEqual({
      nodes: [document.getElementById('short')],
      source: 'article',
      selector: 'article',
    })
  })

  it.each([
    ['an empty', ' \n '],
    ['a 1-character', ' a '],
  ])('skips %s article', (_name, text) => {
    document.body.innerHTML = `<article id="tiny">${text}</article>`

    expect(getArticleNodesAsDefaultSite()).not.toContain(
      document.getElementById('tiny')
    )
  })

  it('returns every non-nested short article', () => {
    document.body.innerHTML =
      `<article id="one">${prose(40)}</article>` +
      `<article id="two">${prose(50)}</article>`

    expect(getArticleNodesAsDefaultSite()).toEqual([
      document.getElementById('one'),
      document.getElementById('two'),
    ])
  })

  it('skips a broad selector match of exactly 100 characters', () => {
    document.body.innerHTML = `<div class="content" id="c">${prose(100)}</div>`

    expect(getArticleNodesAsDefaultSite()).not.toContain(
      document.getElementById('c')
    )
  })

  it('returns only the longest of several broad selector matches over 100 characters', () => {
    document.body.innerHTML =
      `<div class="entry-content" id="a">${prose(150)}</div>` +
      `<div class="entry-content" id="b">${prose(300)}</div>` +
      `<div class="entry-content" id="c">${prose(200)}</div>`

    expect(getArticleNodesAsDefaultSite()).toEqual([
      document.getElementById('b'),
    ])
  })

  it('returns the article on a page with both article and main', () => {
    document.body.innerHTML = `<main><p>${prose(300)}</p><article id="story">${prose(80)}</article></main>`

    expect(getArticleNodesAsDefaultSite()).toEqual([
      document.getElementById('story'),
    ])
  })

  it('returns the broad match on a page with a broad match and main', () => {
    document.body.innerHTML = `<main><p>${prose(300)}</p><div class="post-body" id="post">${prose(200)}</div></main>`

    expect(getArticleNodesAsDefaultSite()).toEqual([
      document.getElementById('post'),
    ])
  })

  it('returns the whole page when no selector hits, however long its text', () => {
    document.body.innerHTML = `<div><h1>A Title</h1><p>${prose(3000)}</p></div>`

    expect(lookupAreaAsDefaultSite()).toEqual(WHOLE_PAGE())
  })
})
