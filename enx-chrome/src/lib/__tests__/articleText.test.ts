import { readArticleText } from '@/lib/articleText'

const textIn = (selector: string, holding: string): Text => {
  const walker = document.createTreeWalker(
    document.querySelector(selector)!,
    NodeFilter.SHOW_TEXT
  )
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data.includes(holding)) return node as Text
  }
  throw new Error(`no "${holding}" under ${selector}`)
}

beforeEach(() => {
  document.body.innerHTML = `
    <aside id="outside">Not part of the story.</aside>
    <article id="one">
      <h1>Chapter   One</h1>
      <p>It was a <em>dark</em> and
         stormy night.</p>
      <script>var hidden = "not text";</script>
    </article>
    <section id="two"><p>The end.</p></section>`
})

const roots = () => [
  document.querySelector('#one')!,
  document.querySelector('#two')!,
]

describe('readArticleText', () => {
  it('joins the text of every root with each whitespace run as one space', () => {
    expect(readArticleText(roots()).text).toBe(
      'Chapter One It was a dark and stormy night. The end.'
    )
  })

  it('maps a position inside any text node to its article offset', () => {
    const article = readArticleText(roots())
    const night = textIn('#one p', 'stormy')

    expect(article.offsetOf(night, night.data.indexOf('stormy'))).toBe(
      article.text.indexOf('stormy')
    )
    expect(article.offsetOf(textIn('#one em', 'dark'), 0)).toBe(
      article.text.indexOf('dark')
    )
    expect(article.offsetOf(textIn('#two', 'end'), 0)).toBe(
      article.text.indexOf('The end')
    )
  })

  it('maps a position in whitespace to the next character of text', () => {
    const article = readArticleText(roots())
    const night = textIn('#one p', 'stormy')

    expect(article.offsetOf(night, night.data.indexOf('\n'))).toBe(
      article.text.indexOf('stormy')
    )
  })

  it('maps a position between elements to the text that follows it', () => {
    const article = readArticleText(roots())
    const paragraph = document.querySelector('#one p')!

    expect(article.offsetOf(paragraph, 1)).toBe(article.text.indexOf('dark'))
  })

  it('has no offset for a position outside the roots', () => {
    const article = readArticleText(roots())

    expect(article.offsetOf(textIn('#outside', 'story'), 0)).toBeNull()
  })
})
