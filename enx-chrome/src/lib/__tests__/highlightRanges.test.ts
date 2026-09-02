import { WordProcessor } from '@/lib/wordProcessor'
import { WordData } from '@/types'

const wd = (overrides: Partial<WordData> = {}): WordData => ({
  Key: 'x',
  English: 'x',
  Pronunciation: '',
  Chinese: '来',
  LoadCount: 5,
  AlreadyAcquainted: 0,
  WordType: 0,
  ...overrides,
})

const textNodesUnder = (root: Node) => WordProcessor.collectTextNodes(root)

beforeEach(() => {
  document.body.innerHTML = ''
  WordProcessor.clearHighlights()
})

describe('WordProcessor.reviewBucket', () => {
  it('returns null for words that should not be highlighted', () => {
    expect(WordProcessor.reviewBucket(wd({ AlreadyAcquainted: 1 }))).toBeNull()
    expect(WordProcessor.reviewBucket(wd({ WordType: 1 }))).toBeNull()
    expect(WordProcessor.reviewBucket(wd({ LoadCount: 0 }))).toBeNull()
  })

  it('maps load count to ascending stages, one per boundary', () => {
    const bucketFor = (c: number) => WordProcessor.reviewBucket(wd({ LoadCount: c }))
    // boundary pairs: last count of each stage, first of the next
    expect([bucketFor(2), bucketFor(3)]).toEqual([1, 2])
    expect([bucketFor(5), bucketFor(6)]).toEqual([2, 3])
    expect([bucketFor(10), bucketFor(11)]).toEqual([3, 4])
    expect([bucketFor(18), bucketFor(19)]).toEqual([4, 5])
    expect(bucketFor(1)).toBe(1)
    expect(bucketFor(9999)).toBe(WordProcessor.REVIEW_BUCKET_COUNT)
  })
})

describe('WordProcessor.buildHighlightRanges', () => {
  it('groups matched words into their review buckets', () => {
    document.body.innerHTML =
      '<p>the endgame is clearly the real endgame here</p>'
    const buckets = WordProcessor.buildHighlightRanges(
      textNodesUnder(document.body),
      {
        endgame: wd({ LoadCount: 1 }), // bucket 1
        clearly: wd({ LoadCount: 9 }), // bucket 3
      }
    )
    expect([...buckets.keys()].sort()).toEqual([1, 3])
    expect(buckets.get(1)!.map(r => r.toString())).toEqual([
      'endgame',
      'endgame',
    ])
    expect(buckets.get(3)!.map(r => r.toString())).toEqual(['clearly'])
  })

  it('produces no Range for words not in the dict or rejected by reviewBucket', () => {
    document.body.innerHTML = '<p>the endgame is clearly known here</p>'
    const buckets = WordProcessor.buildHighlightRanges(
      textNodesUnder(document.body),
      {
        endgame: wd({ AlreadyAcquainted: 1 }), // rejected
        clearly: wd({ LoadCount: 0 }), // rejected
        // "known" / "here" not in dict
      }
    )
    expect(buckets.size).toBe(0)
  })

  it('matches contractions and hyphenated compounds as whole words', () => {
    document.body.innerHTML =
      "<p>it's a well-known problem, isn't it</p>"
    const buckets = WordProcessor.buildHighlightRanges(
      textNodesUnder(document.body),
      {
        "it's": wd(),
        'well-known': wd(),
        "isn't": wd(),
      }
    )
    const hit = [...buckets.values()].flat().map(r => r.toString())
    expect(hit).toContain("it's")
    expect(hit).toContain('well-known')
    expect(hit).toContain("isn't")
  })

  it('tokenizes word-then-number compounds the way extractWords does (letter part only)', () => {
    // ICU treats "19" as word-like; extractWords stops at the digit and
    // yields "covid" / "catch", which is how wordDict is keyed.
    document.body.innerHTML = '<p>the COVID-19 and Catch-22 situation</p>'
    const extracted = WordProcessor.extractWords(
      document.querySelector('p')!.textContent || ''
    )
    expect(extracted).toEqual(
      expect.arrayContaining(['covid', 'catch', 'situation'])
    )

    const buckets = WordProcessor.buildHighlightRanges(
      textNodesUnder(document.body),
      { covid: wd(), catch: wd() }
    )
    const hit = [...buckets.values()].flat().map(r => r.toString())
    expect(hit).toEqual(['COVID', 'Catch'])
  })

  it('does not highlight words inside an excluded subtree', () => {
    document.body.innerHTML =
      '<p>the endgame is <a href="#">the endgame link</a> here</p>'
    WordProcessor.rebuildHighlights(document.body, { endgame: wd({ LoadCount: 4 }) })
    const ranges = [...(CSS.highlights.get('enx-hl-2') ?? [])]
    // Only the one occurrence outside the <a>.
    expect(ranges.map(r => r.toString())).toEqual(['endgame'])
  })

  it('creates and moves no element nodes (article DOM is untouched)', () => {
    document.body.innerHTML =
      '<p id="p"><span id="s">the endgame is <b id="b">clearly</b> here</span></p>'
    const p = document.getElementById('p')
    const s = document.getElementById('s')
    const b = document.getElementById('b')
    const htmlBefore = document.body.innerHTML

    WordProcessor.rebuildHighlights(document.body, {
      endgame: wd({ LoadCount: 10 }),
      clearly: wd(),
    })

    expect(document.getElementById('p')).toBe(p)
    expect(document.getElementById('s')).toBe(s)
    expect(document.getElementById('b')).toBe(b)
    expect(document.body.innerHTML).toBe(htmlBefore)
  })
})

describe('WordProcessor.applyHighlights / clearHighlights', () => {
  it('registers one CSS.highlights entry per non-empty bucket', () => {
    const r = () => document.createRange()
    WordProcessor.applyHighlights(
      new Map([
        [1, [r(), r()]],
        [3, [r()]],
        [5, []], // empty -> not registered
      ])
    )
    expect([...CSS.highlights.keys()].sort()).toEqual(['enx-hl-1', 'enx-hl-3'])
    expect(CSS.highlights.get('enx-hl-1')!.size).toBe(2)
  })

  it('replaces previous ENX highlights and leaves host-page highlights alone', () => {
    CSS.highlights.set('site-search', new Highlight(document.createRange()))
    WordProcessor.applyHighlights(new Map([[1, [document.createRange()]]]))
    WordProcessor.applyHighlights(new Map([[2, [document.createRange()]]]))

    expect([...CSS.highlights.keys()].sort()).toEqual(['enx-hl-2', 'site-search'])

    WordProcessor.clearHighlights()
    expect([...CSS.highlights.keys()]).toEqual(['site-search'])
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
    expect(WordProcessor.expandToWordRange(n, 10)?.toString()).toBe('well-known') // in "known"
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

  it('returns null for a non-text node', () => {
    document.body.innerHTML = '<p>hi</p>'
    expect(WordProcessor.expandToWordRange(document.querySelector('p')!, 0)).toBeNull()
  })
})
