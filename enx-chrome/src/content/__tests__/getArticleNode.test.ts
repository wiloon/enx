import { WordProcessor } from '@/lib/wordProcessor'

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
