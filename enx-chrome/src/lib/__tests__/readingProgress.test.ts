import {
  ARTICLE_MIN_WORDS,
  ReadingSession,
  charOffsetToWords,
  qualifiesAsArticle,
} from '../readingProgress'

// A paragraph element whose textContent is `chars` characters long.
function para(chars: number): HTMLElement {
  const p = document.createElement('p')
  p.textContent = 'x'.repeat(chars)
  document.body.appendChild(p)
  return p
}

// A Range starting `offset` characters into `node`'s text.
function rangeAt(node: HTMLElement, offset: number): Range {
  const text = node.firstChild as Text
  const range = document.createRange()
  range.setStart(text, offset)
  range.setEnd(text, offset)
  return range
}

// jsdom has no layout: every getBoundingClientRect() is zeroes, so a test
// that wants to exercise noteScroll has to supply the geometry itself.
function stubRect(node: HTMLElement, top: number, height: number): void {
  node.getBoundingClientRect = () =>
    ({
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 100,
    }) as DOMRect
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('charOffsetToWords', () => {
  it('scales an offset into the article by word density', () => {
    expect(charOffsetToWords(500, 1000, 200)).toBe(100)
  })

  it('clamps out-of-range offsets instead of extrapolating', () => {
    expect(charOffsetToWords(5000, 1000, 200)).toBe(200)
    expect(charOffsetToWords(-5, 1000, 200)).toBe(0)
  })

  it('is zero for an empty article rather than dividing by zero', () => {
    expect(charOffsetToWords(10, 0, 0)).toBe(0)
  })
})

describe('qualifiesAsArticle', () => {
  it('rejects a short read of a long article', () => {
    expect(qualifiesAsArticle(300, 5000)).toBe(false) // 6%
  })

  it('rejects a fully-read text that is too short to be an article', () => {
    expect(qualifiesAsArticle(30, 30)).toBe(false) // a tweet
  })

  it('accepts a read that clears both bars', () => {
    expect(qualifiesAsArticle(400, 1000)).toBe(true)
  })
})

describe('ReadingSession', () => {
  it('raises the watermark to a clicked word', () => {
    const node = para(1000)
    const session = new ReadingSession([node], 200)

    session.noteInteraction(rangeAt(node, 500))

    expect(session.watermarkWords).toBe(100)
  })

  it('uses a cumulative offset across multiple article nodes', () => {
    const first = para(1000)
    const second = para(1000)
    const session = new ReadingSession([first, second], 400)

    // Halfway into the SECOND node is three quarters of the whole article.
    session.noteInteraction(rangeAt(second, 500))

    expect(session.watermarkWords).toBe(300)
  })

  it('never lowers the watermark when the user goes back up', () => {
    const node = para(1000)
    const session = new ReadingSession([node], 200)

    session.noteInteraction(rangeAt(node, 800))
    session.noteInteraction(rangeAt(node, 100))

    expect(session.watermarkWords).toBe(160)
  })

  it('ignores an interaction outside the article nodes', () => {
    const node = para(1000)
    const outside = para(100)
    const session = new ReadingSession([node], 200)

    session.noteInteraction(rangeAt(outside, 50))

    expect(session.watermarkWords).toBe(0)
  })

  it('discounts the screenful just scrolled into view', () => {
    const node = para(1000)
    stubRect(node, -800, 2000) // 800px scrolled past the viewport top
    const session = new ReadingSession([node], 1000)

    // Viewport 800 tall -> the read line is at y=0, i.e. 800/2000 of the node.
    session.noteScroll(800)

    expect(session.watermarkWords).toBe(400)
  })

  it('credits nothing for an article still below the fold', () => {
    const node = para(1000)
    stubRect(node, 900, 2000) // starts below a 800px viewport
    const session = new ReadingSession([node], 1000)

    session.noteScroll(800)

    expect(session.watermarkWords).toBe(0)
  })

  it('reports each word once, as a delta', () => {
    const node = para(1000)
    const session = new ReadingSession([node], 1000)

    session.noteInteraction(rangeAt(node, 300))
    expect(session.takeDelta().wordsRead).toBe(300)

    session.noteInteraction(rangeAt(node, 500))
    expect(session.takeDelta().wordsRead).toBe(200)

    // Nothing new since the last flush.
    expect(session.takeDelta().wordsRead).toBe(0)
  })

  it('counts the article exactly once, on the flush that qualifies it', () => {
    const node = para(1000)
    const session = new ReadingSession([node], 1000)

    session.noteInteraction(rangeAt(node, 50)) // 50 words: under the floor
    expect(session.takeDelta().articlesRead).toBe(0)

    session.noteInteraction(rangeAt(node, 400))
    expect(session.watermarkWords).toBeGreaterThanOrEqual(ARTICLE_MIN_WORDS)
    expect(session.takeDelta().articlesRead).toBe(1)

    session.noteInteraction(rangeAt(node, 900))
    expect(session.takeDelta().articlesRead).toBe(0)
  })
})
