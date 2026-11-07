import { extractText } from '../extractText'

const PAGE = `
  <div id="area">
    <h1>Title</h1>
    <script>var tracking = 1</script>
    <style>.x { color: red }</style>
    <noscript>Enable JavaScript</noscript>
    <p>Body text.</p>
    <ul><li><a href="/a">First link</a></li><li><a href="/b">Second link</a></li></ul>
    <pre><code>const answer = 42</code></pre>
  </div>`

describe('extractText', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('drops script, style and noscript text and keeps links and code', () => {
    document.body.innerHTML = PAGE
    const text = extractText([document.getElementById('area')!])

    expect(text).toContain('Title')
    expect(text).toContain('Body text.')
    expect(text).toContain('First link')
    expect(text).toContain('Second link')
    expect(text).toContain('const answer = 42')
    expect(text).not.toContain('tracking')
    expect(text).not.toContain('color')
    expect(text).not.toContain('Enable JavaScript')
  })

  it('extracts a parsed reference document the same way', () => {
    const reference = new DOMParser().parseFromString(PAGE, 'text/html')
    document.body.innerHTML = PAGE

    expect(extractText([reference.getElementById('area')!])).toBe(
      extractText([document.getElementById('area')!])
    )
  })

  it('leaves the live nodes untouched', () => {
    document.body.innerHTML = PAGE
    extractText([document.getElementById('area')!])

    expect(document.querySelectorAll('script, style, noscript')).toHaveLength(3)
  })

  it('joins several nodes with whitespace between them', () => {
    document.body.innerHTML = '<p id="a">one</p><p id="b">two</p>'

    expect(
      extractText([
        document.getElementById('a')!,
        document.getElementById('b')!,
      ])
    ).toBe('one\ntwo')
  })
})
