import { WordProcessor } from '@/lib/wordProcessor'
import { WordData } from '@/types'

// This file is the coverage for the CSS Custom Highlight API path
// (ADR-011). When the element-wrapping path was removed (issue #11), these
// test files were deleted as they only exercised the old path via local
// re-implementations: inPlaceHighlighting, flexContainerFix, htmlRendering,
// whitespacePreservation, realWorldCase, highlightingIntegration,
// codeBlockExclusion. The exclusion set, review bucketing and click-path
// word boundaries are here; painting, word matching and the untouched DOM
// are covered with the paint window (paintWindow.test.ts,
// blockPartition.test.ts, ADR-069).

const wd = (overrides: Partial<WordData> = {}): WordData => ({
  Key: 'x',
  English: 'x',
  Pronunciation: '',
  Chinese: '来',
  LoadCount: 5,
  Known: false,
  WordType: 0,
  ...overrides,
})

const textNodesUnder = (root: Node) => WordProcessor.collectTextNodes(root)

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('review-stage palette', () => {
  const parsed = WordProcessor.HIGHLIGHT_BUCKET_COLORS.map(c => {
    const m = c.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
    if (!m) throw new Error(`not an oklch() colour: ${c}`)
    return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) }
  })

  it('has exactly REVIEW_BUCKET_COUNT colours', () => {
    expect(WordProcessor.HIGHLIGHT_BUCKET_COLORS).toHaveLength(
      WordProcessor.REVIEW_BUCKET_COUNT
    )
  })

  // The ramp encodes an order, so it has to be readable as one: a single hue
  // whose lightness climbs. A rainbow passes every other test we have.
  it('is a single-hue ramp with monotonically rising lightness', () => {
    expect(new Set(parsed.map(p => p.H)).size).toBe(1)
    for (let i = 1; i < parsed.length; i++) {
      expect(parsed[i].L - parsed[i - 1].L).toBeGreaterThanOrEqual(0.06)
    }
  })
})

describe('WordProcessor.reviewBucket', () => {
  it('returns null for words that should not be highlighted', () => {
    expect(WordProcessor.reviewBucket(wd({ Known: true }))).toBeNull()
    expect(WordProcessor.reviewBucket(wd({ WordType: 1 }))).toBeNull()
    expect(WordProcessor.reviewBucket(wd({ LoadCount: 0 }))).toBeNull()
  })

  it('maps load count to ascending stages, one per boundary', () => {
    const bucketFor = (c: number) =>
      WordProcessor.reviewBucket(wd({ LoadCount: c }))
    // boundary pairs: last count of each stage, first of the next
    expect([bucketFor(2), bucketFor(3)]).toEqual([1, 2])
    expect([bucketFor(5), bucketFor(6)]).toEqual([2, 3])
    expect([bucketFor(10), bucketFor(11)]).toEqual([3, 4])
    expect([bucketFor(18), bucketFor(19)]).toEqual([4, 5])
    expect(bucketFor(1)).toBe(1)
    expect(bucketFor(9999)).toBe(WordProcessor.REVIEW_BUCKET_COUNT)
  })
})

describe('WordProcessor.collectTextNodes', () => {
  it('leaves out text inside excluded subtrees (a / code / pre / button)', () => {
    document.body.innerHTML = `
      <p>the endgame is here</p>
      <p><a href="#">endgame</a></p>
      <p><code>endgame</code></p>
      <pre>endgame</pre>
      <p><button>endgame</button></p>
    `
    expect(
      textNodesUnder(document.body).map(n => n.textContent?.trim())
    ).toEqual(['the endgame is here'])
  })

  it('skips a whole X Article code block, including its language label', () => {
    // The label ("plaintext") sits in a plain <span> beside the <pre><code>
    // body, so the tag list alone would let it through as a lookup word.
    document.body.innerHTML = `
      <p>the endgame is here</p>
      <div data-testid="markdown-code-block">
        <span>endgame</span>
        <pre><code>endgame</code></pre>
      </div>
    `
    expect(
      textNodesUnder(document.body).map(n => n.textContent?.trim())
    ).toEqual(['the endgame is here'])
  })

  it('leaves out the text of summary and label controls', () => {
    document.body.innerHTML =
      '<details><summary>Contents</summary><p>the endgame is here</p></details>' +
      '<label for="q">Search</label><input id="q">'

    expect(
      textNodesUnder(document.body).map(n => n.textContent?.trim())
    ).toEqual(['the endgame is here'])
  })

  it("skips the extension's own UI inserted into the article", () => {
    // Anything the extension marks with data-enx-ui (e.g. the session
    // notice) must not have its words highlighted.
    document.body.innerHTML = `
      <p>the endgame is here</p>
      <div data-enx-ui>Click the endgame</div>
    `
    expect(
      textNodesUnder(document.body).map(n => n.textContent?.trim())
    ).toEqual(['the endgame is here'])
  })
})

describe('WordProcessor.expandToWordRange', () => {
  const textNode = (html: string): Text => {
    document.body.innerHTML = html
    return document.querySelector('p')!.firstChild as Text
  }

  it('expands a caret inside a plain word to the whole word', () => {
    const n = textNode('<p>the endgame is here</p>')
    const range = WordProcessor.expandToWordRange(n, 6) // inside "endgame"
    expect(range?.toString()).toBe('endgame')
  })

  it('expands to the whole contraction from a caret inside it', () => {
    const n = textNode("<p>you can't do it</p>")
    expect(WordProcessor.expandToWordRange(n, 6)?.toString()).toBe("can't")
  })

  it('expands to the whole hyphenated compound from either half', () => {
    const n = textNode('<p>a well-known fact</p>')
    expect(WordProcessor.expandToWordRange(n, 3)?.toString()).toBe('well-known') // in "well"
    expect(WordProcessor.expandToWordRange(n, 10)?.toString()).toBe(
      'well-known'
    ) // in "known"
  })

  it('returns null on punctuation / whitespace between words and at string end', () => {
    const n = textNode('<p>end. Start</p>')
    expect(WordProcessor.expandToWordRange(n, 4)).toBeNull() // the space after "end."
    const trailing = textNode('<p>done.</p>')
    expect(WordProcessor.expandToWordRange(trailing, 5)).toBeNull() // past the period
  })

  it('returns null when the caret node is inside any excluded subtree', () => {
    for (const tag of ['a', 'button', 'code', 'pre', 'textarea']) {
      document.body.innerHTML = `<p>see <${tag} id="x">the excluded phrase</${tag}> ok</p>`
      const inner = document.getElementById('x')!.firstChild as Text
      expect(WordProcessor.expandToWordRange(inner, 5)).toBeNull()
    }
  })

  // With body as the article root (#565), page controls sit inside it; a click
  // on their text keeps its default action (toggle a details, focus an input).
  it.each(['summary', 'label'])('returns null for text inside a %s', tag => {
    document.body.innerHTML =
      tag === 'summary'
        ? '<details><summary id="x">Table of contents</summary><p>Chapter one</p></details>'
        : '<label id="x" for="q">Search the book</label><input id="q">'
    const inner = document.getElementById('x')!.firstChild as Text

    expect(WordProcessor.expandToWordRange(inner, 2)).toBeNull()
  })

  it('returns null for a non-text node', () => {
    document.body.innerHTML = '<p>hi</p>'
    expect(
      WordProcessor.expandToWordRange(document.querySelector('p')!, 0)
    ).toBeNull()
  })
})
