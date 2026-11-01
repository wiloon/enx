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

// Characterization of the selection before the body fallback (#565): one
// simplified page shape per row, pinning what the selector list and the
// largest-text fallback pick. `expected` is a selector for the one element
// returned, or null for [].
describe('WordProcessor.getArticleNodes page shapes', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const rows: Array<{ shape: string; html: string; expected: string | null }> =
    [
      {
        shape: 'an article element',
        html: `
          <div id="nav">${links(5, 20)}</div>
          <article id="story"><p>${prose(800)}</p></article>
          <footer>${prose(200)}</footer>`,
        expected: '#story',
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
      },
      {
        shape: 'a #root wrapper around the whole page',
        html: `
          <div id="root">
            <div id="header">${links(4, 15)}</div>
            <div id="body-text"><p>${prose(700)}</p><p>${prose(700)}</p></div>
            <div id="footer"><p>${prose(150)}</p></div>
          </div>`,
        expected: '#root',
      },
      {
        shape: 'a home page whose main holds most of the text',
        html: `
          <header><div id="menu">${links(6, 12)}</div></header>
          <main id="home">
            <div class="card"><p>${prose(600)}</p></div>
            <div class="card"><p>${prose(600)}</p></div>
            <div class="card"><p>${prose(600)}</p></div>
          </main>
          <footer><p>${prose(200)}</p></footer>`,
        expected: '#home',
      },
      {
        shape: 'a long navigation beside the article',
        html: `
          <div id="navigation">${links(60, 30)}</div>
          <div id="story"><p>${prose(1200)}</p></div>`,
        expected: '#story',
      },
      {
        shape: 'a docs page with div.document',
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
        expected: '.document',
      },
      {
        shape: 'a list page of mostly links (Hacker News shape)',
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
        expected: null,
      },
      {
        // #563 will change this row deliberately.
        shape: 'a short title page',
        html: `<h1>A Short Title</h1><p>${prose(120)}</p>`,
        expected: null,
      },
    ]

  it.each(rows)('$shape', ({ html, expected }) => {
    document.body.innerHTML = html

    const nodes = getArticleNodesAsDefaultSite()

    if (expected === null) {
      expect(nodes).toEqual([])
    } else {
      expect(nodes).toHaveLength(1)
      expect(nodes[0]).toBe(document.querySelector(expected))
    }
  })
})

// Inline script exactly `length` characters long.
function js(length: number): string {
  return 'window.__data.push({k:1});'.repeat(length).slice(0, length)
}

// `element` without its script, style and noscript subtrees, for asserting
// fixture preconditions on the text a reader sees.
function visible(element: Element): Element {
  const clone = element.cloneNode(true) as Element
  clone.querySelectorAll('script, style, noscript').forEach(el => el.remove())
  return clone
}

function textLength(element: Element): number {
  return element.textContent?.length ?? 0
}

function share(candidate: Element, of: Element): number {
  return textLength(candidate) / textLength(of)
}

// #565: when no container holds a real share of the page's text, the body is
// the article (paragraphs sitting directly under <body>).
describe('WordProcessor.getArticleNodes body fallback', () => {
  afterEach(() => {
    if (!document.body) {
      document.documentElement.appendChild(document.createElement('body'))
    }
    document.body.innerHTML = ''
  })

  it('returns body for paragraphs directly under body beside a small section', () => {
    document.body.innerHTML =
      `<h1>Chapter One</h1><p>${prose(2000)}</p><p>${prose(2000)}</p>` +
      `<section class="footnotes"><p>${prose(600)}</p></section>`

    expect(getArticleNodesAsDefaultSite()).toEqual([document.body])
  })

  it('returns body for paragraphs directly under body with no candidate container', () => {
    document.body.innerHTML = `<h1>An Essay</h1><p>${prose(800)}</p><p>${prose(800)}</p>`

    expect(getArticleNodesAsDefaultSite()).toEqual([document.body])
  })

  it('keeps a container that holds most of the text', () => {
    document.body.innerHTML = `<div id="story"><p>${prose(3000)}</p></div><p>${prose(500)}</p>`

    const nodes = getArticleNodesAsDefaultSite()

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toBe(document.getElementById('story'))
  })

  it('keeps the largest candidate at exactly a 25% share of the body text', () => {
    document.body.innerHTML = `<section id="part">${prose(1000)}</section><p>${prose(3000)}</p>`
    const part = document.getElementById('part')!
    expect(share(part, document.body)).toBe(0.25)

    const nodes = getArticleNodesAsDefaultSite()

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toBe(part)
  })

  it('returns body when the largest candidate holds just under 25% of the body text', () => {
    document.body.innerHTML = `<section id="part">${prose(1000)}</section><p>${prose(3001)}</p>`
    expect(share(document.getElementById('part')!, document.body)).toBeLessThan(
      0.25
    )

    expect(getArticleNodesAsDefaultSite()).toEqual([document.body])
  })

  it('keeps the container holding most of the visible text beside a large inline script (Guardian shape)', () => {
    document.body.innerHTML =
      `<script>${js(20000)}</script>` +
      `<div id="main-content"><p>${prose(3000)}</p></div><p>${prose(600)}</p>`
    const main = document.getElementById('main-content')!
    expect(share(main, document.body)).toBeLessThan(0.25)
    expect(share(visible(main), visible(document.body))).toBeGreaterThanOrEqual(
      0.25
    )

    const nodes = getArticleNodesAsDefaultSite()

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toBe(main)
  })

  it('returns [] for mostly-link visible text beside a large inline script with no eligible candidate (BBC shape)', () => {
    document.body.innerHTML =
      `<script>${js(10000)}</script>` +
      `<div class="nav">${links(40, 50)}</div>` +
      `<div class="promo">${links(30, 50)}</div>` +
      `<p>${prose(400)}</p><p>${prose(400)}</p>`
    expect(WordProcessor.linkDensity(document.body)).toBeLessThanOrEqual(0.5)
    expect(WordProcessor.linkDensity(visible(document.body))).toBeGreaterThan(
      0.5
    )
    // Every candidate is rejected on link density, so the winner's share is 0.
    document.querySelectorAll('div').forEach(div => {
      expect(WordProcessor.linkDensity(div)).toBeGreaterThan(0.5)
    })

    expect(getArticleNodesAsDefaultSite()).toEqual([])
  })

  it('returns body at exactly the link-density threshold', () => {
    document.body.innerHTML = `<p>${prose(600)}</p><p><a href="/x">${prose(600)}</a></p>`
    expect(WordProcessor.linkDensity(document.body)).toBe(0.5)

    expect(getArticleNodesAsDefaultSite()).toEqual([document.body])
  })

  it('returns the eligible largest candidate when body is over the link-density threshold (Gutenberg home shape)', () => {
    document.body.innerHTML = `<div id="intro"><p>${prose(700)}</p></div>${links(60, 60)}`
    const intro = document.getElementById('intro')!
    expect(share(intro, document.body)).toBeLessThan(0.25)
    expect(WordProcessor.linkDensity(document.body)).toBeGreaterThan(0.5)

    const nodes = getArticleNodesAsDefaultSite()

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toBe(intro)
  })

  it('returns [] for a list page of links with no eligible candidate (Hacker News shape)', () => {
    document.body.innerHTML = `<table>${Array.from(
      { length: 30 },
      (_, i) =>
        `<tr><td><a href="/item${i}">${prose(60)}</a></td></tr>` +
        `<tr><td>${i} points by <a href="/user${i}">someuser</a> three hours ago | ` +
        `<a href="/hide${i}">hide</a> | <a href="/c${i}">45 comments</a></td></tr>`
    ).join('')}</table>`
    const eligible = WordProcessor.collectTextNodes(document.body)
    expect(
      eligible.reduce((sum, node) => sum + node.data.length, 0)
    ).toBeGreaterThan(500)
    expect(WordProcessor.linkDensity(document.body)).toBeGreaterThan(0.5)

    expect(getArticleNodesAsDefaultSite()).toEqual([])
  })

  it('returns [] with exactly 500 lookup-eligible characters and no candidate', () => {
    document.body.innerHTML = `<p>${prose(500)}</p>`

    expect(getArticleNodesAsDefaultSite()).toEqual([])
  })

  it('returns body with 501 lookup-eligible characters and no candidate', () => {
    document.body.innerHTML = `<p>${prose(501)}</p>`

    expect(getArticleNodesAsDefaultSite()).toEqual([document.body])
  })

  it('returns [] when a large inline script inflates a body with under 500 lookup-eligible characters', () => {
    document.body.innerHTML = `<script>${js(20000)}</script><p>${prose(400)}</p>`

    expect(getArticleNodesAsDefaultSite()).toEqual([])
  })

  it('keeps a small-share candidate when the body has under 500 lookup-eligible characters', () => {
    document.body.innerHTML =
      `<div id="snippet"><p>${prose(300)}</p><pre>${prose(300)}</pre></div>` +
      `<pre>${prose(5000)}</pre>`
    const snippet = document.getElementById('snippet')!
    expect(share(snippet, document.body)).toBeLessThan(0.25)

    const nodes = getArticleNodesAsDefaultSite()

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toBe(snippet)
  })

  it('returns [] when the text over 500 characters sits only in pre and code', () => {
    document.body.innerHTML = `<pre>${prose(2000)}</pre><p><code>${prose(600)}</code></p>`

    expect(getArticleNodesAsDefaultSite()).toEqual([])
  })

  it('returns body when a script-heavy candidate wins on raw text but holds under 25% of the visible text', () => {
    document.body.innerHTML =
      `<div id="widget"><script>${js(20000)}</script><p>${prose(100)}</p></div>` +
      `<div id="main"><p>${prose(5000)}</p></div>`
    const widget = document.getElementById('widget')!
    expect(textLength(widget)).toBeGreaterThan(
      textLength(document.getElementById('main')!)
    )
    expect(share(visible(widget), visible(document.body))).toBeLessThan(0.25)

    expect(getArticleNodesAsDefaultSite()).toEqual([document.body])
  })

  it('returns [] for a document with no body', () => {
    document.body.remove()
    expect(document.body).toBeNull()

    expect(getArticleNodesAsDefaultSite()).toEqual([])
  })

  it('keeps a selector match even when it holds a small share of the body text', () => {
    document.body.innerHTML = `<p>${prose(5000)}</p><article id="teaser"><p>${prose(200)}</p></article>`

    const nodes = getArticleNodesAsDefaultSite()

    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toBe(document.getElementById('teaser'))
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

    const nodes = WordProcessor.getArticleNodes()

    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('body')
  })

  it('should fall back to the largest text container when no selector matches', () => {
    document.body.innerHTML = `
      <div>${'Fallback content with enough text to pass the length threshold. '.repeat(10)}</div>
    `

    const nodes = WordProcessor.getArticleNodes()

    expect(nodes).toHaveLength(1)
    expect(nodes[0].textContent).toContain('Fallback content')
  })

  it('should skip a high-link-density candidate in the largest-text fallback, even when it has more raw text than the real article', () => {
    // A related-links block whose raw text is longer than the real article
    // body, but almost all of it lives inside <a> tags (adr-034 Decision 3).
    const linkText = 'Related story headline that is fairly long. '.repeat(20)
    // The real article: plain prose, well over the 500-char floor, one
    // incidental inline link -- low link density.
    const articleText = 'Real article prose with normal sentences. '.repeat(15)

    document.body.innerHTML = `
      <div id="related-links">
        ${linkText
          .match(/.{1,45}/g)!
          .map(t => `<a href="/x">${t}</a>`)
          .join('')}
      </div>
      <div id="real-article">
        <p>${articleText}<a href="/see-also">see also</a></p>
      </div>
    `

    expect(
      document.getElementById('related-links')!.textContent!.length
    ).toBeGreaterThan(
      document.getElementById('real-article')!.textContent!.length
    )

    const nodes = WordProcessor.getArticleNodes()

    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('real-article')
  })
})
