import {
  buildReadingAnchor,
  findReadingAnchor,
  readingBook,
} from '@/lib/readingAnchor'
import { checkAnchor } from '@/lib/readingPositions'
import { tomeshelfBookId, tomeshelfBookKey } from '@/lib/siteAdapters'

const ARTICLE =
  'Sense and Sensibility The family of Dashwood had long been settled in Sussex. Their estate was large, and their residence was at Norland Park. The reader turns another page of the long story.'
const PAGE = { sourceUrl: 'https://standardebooks.org/a', title: 'A book' }

describe('buildReadingAnchor', () => {
  it('records the sentence with 32 characters of context, its offset and the article length', () => {
    const offset = ARTICLE.indexOf('Their')

    expect(
      buildReadingAnchor(
        ARTICLE,
        offset,
        'Their estate was large, and their residence was at Norland Park.',
        PAGE,
        1234
      )
    ).toEqual({
      sentence:
        'Their estate was large, and their residence was at Norland Park.',
      before: 'ad long been settled in Sussex. ',
      after: ' The reader turns another page o',
      offset,
      articleLength: ARTICLE.length,
      sourceUrl: PAGE.sourceUrl,
      title: 'A book',
      occurredAt: 1234,
    })
  })

  it('keeps shorter context at the edges of the article', () => {
    const anchor = buildReadingAnchor(
      ARTICLE,
      0,
      'Sense and Sensibility',
      PAGE,
      1
    )

    expect(anchor).toMatchObject({ before: '', offset: 0 })
  })

  it('normalizes the whitespace of the sentence it is given', () => {
    const anchor = buildReadingAnchor(
      ARTICLE,
      ARTICLE.indexOf('Their'),
      '  Their estate was large,\n      and their residence was at Norland Park.\t',
      PAGE,
      1
    )

    expect(anchor?.sentence).toBe(
      'Their estate was large, and their residence was at Norland Park.'
    )
  })

  it('refuses a sentence that is not at the offset in the article text', () => {
    expect(
      buildReadingAnchor(ARTICLE, 0, 'Their estate was large,', PAGE, 1)
    ).toBeNull()
  })

  it('refuses an empty sentence or an offset outside the article', () => {
    expect(buildReadingAnchor(ARTICLE, 0, '   ', PAGE, 1)).toBeNull()
    expect(buildReadingAnchor(ARTICLE, null, 'Sense', PAGE, 1)).toBeNull()
  })
})

describe('findReadingAnchor', () => {
  const anchorAt = (text: string, sentence: string, occurrence = 0) => {
    let offset = -1
    for (let i = 0; i <= occurrence; i++) {
      offset = text.indexOf(sentence, offset + 1)
    }
    const anchor = buildReadingAnchor(text, offset, sentence, PAGE, 1)
    if (!anchor) throw new Error(`"${sentence}" is not in the text`)
    return anchor
  }

  it('finds the sentence where it now starts when text was added before it', () => {
    const anchor = anchorAt(ARTICLE, 'Their estate was large,')
    const changed = `A new preface. ${ARTICLE}`

    expect(findReadingAnchor(changed, anchor)).toEqual({
      found: true,
      offset: changed.indexOf('Their estate'),
    })
  })

  it('tells a repeated sentence apart by its context', () => {
    const text =
      'He said: "Never again." She laughed. He said: "Never again." The door shut.'
    const anchor = anchorAt(text, 'He said: "Never again."', 1)
    const changed = `Prologue. ${text}`

    expect(findReadingAnchor(changed, anchor)).toEqual({
      found: true,
      offset: changed.lastIndexOf('He said'),
    })
  })

  it('prefers the occurrence with more matching context to the nearer one', () => {
    const text = 'Stop. Alpha beta gamma. Stop. Delta epsilon zeta.'
    const anchor = anchorAt(text, 'Stop.', 1)
    const changed = 'Stop. Delta epsilon zeta. Stop. Omega.'

    expect(findReadingAnchor(changed, anchor)).toEqual({
      found: true,
      offset: 0,
    })
  })

  it('takes the occurrence nearest the old offset when the context ties', () => {
    const text = `${'Again. '.repeat(40)}`.trim()
    const anchor = anchorAt(text, 'Again.', 30)

    expect(findReadingAnchor(text, anchor)).toEqual({
      found: true,
      offset: anchor.offset,
    })
  })

  it('reports an absent sentence with the same fraction of the article', () => {
    const anchor = anchorAt(ARTICLE, 'Their estate was large,')
    const changed = 'x'.repeat(1000)

    expect(findReadingAnchor(changed, anchor)).toEqual({
      found: false,
      offset: Math.round((anchor.offset / anchor.articleLength) * 1000),
    })
  })
})

describe('readingBook', () => {
  it('keys the book by the normalized page address by default', () => {
    expect(
      readingBook({}, 'https://example.com/story?utm_source=x&id=7#chapter-2')
    ).toEqual({
      bookKey: 'https://example.com/story?id=7',
      sourceUrl: 'https://example.com/story?id=7',
    })
  })

  it("takes the adapter's book key, normalized the same way", () => {
    const adapter = {
      bookKey: (href: string) => href.replace(/\/text\/.*$/, '#whole-book'),
    }

    expect(
      readingBook(adapter, 'https://standardebooks.org/ebooks/a/b/text/c-1')
    ).toEqual({
      bookKey: 'https://standardebooks.org/ebooks/a/b',
      sourceUrl: 'https://standardebooks.org/ebooks/a/b/text/c-1',
    })
  })

  it('has no book for an address savedPageKey rejects', () => {
    expect(readingBook({}, 'file:///home/me/book.html')).toBeNull()
    expect(
      readingBook({ bookKey: () => 'chrome://newtab' }, 'https://example.com/')
    ).toBeNull()
  })
})

describe('tomeshelf book key (ADR-088 Decision 4)', () => {
  afterEach(() => {
    document.head.innerHTML = ''
  })

  const setBook = (id: string | null) => {
    document.head.innerHTML = '<meta name="generator" content="tomeshelf 1.0">'
    if (id === null) return
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'tomeshelf:book')
    meta.setAttribute('content', id)
    document.head.appendChild(meta)
  }

  const adapter = {
    bookKey: (href: string) => {
      const id = tomeshelfBookId(document)
      return id ? tomeshelfBookKey(href, id) : href
    },
  }

  const sampleAnchor = (sourceUrl: string) => ({
    sentence: 'Their estate was large.',
    before: 'settled in Sussex. ',
    after: ' Their residence was at',
    offset: 10,
    articleLength: 100,
    sourceUrl,
    title: 'A book',
    occurredAt: 1,
  })

  it('gives the same key and different sourceUrls for two documents of one book', () => {
    setBook('9f2c-book')
    const a = readingBook(
      adapter,
      'https://tomeshelf.wiloon.lab/books/x/read/1'
    )
    const b = readingBook(
      adapter,
      'https://tomeshelf.wiloon.lab/books/x/read/2'
    )
    expect(a?.bookKey).toBe(
      'https://tomeshelf.wiloon.lab/?enx-tomeshelf-book=9f2c-book'
    )
    expect(a?.bookKey).toBe(b?.bookKey)
    expect(a?.sourceUrl).toBe('https://tomeshelf.wiloon.lab/books/x/read/1')
    expect(b?.sourceUrl).toBe('https://tomeshelf.wiloon.lab/books/x/read/2')
    expect(checkAnchor(a!.bookKey, sampleAnchor(a!.sourceUrl)).ok).toBe(true)
    expect(checkAnchor(b!.bookKey, sampleAnchor(b!.sourceUrl)).ok).toBe(true)
  })

  it('gives different keys for different book ids', () => {
    setBook('book-a')
    const a = readingBook(adapter, 'https://tomeshelf.wiloon.lab/read/1')
    setBook('book-b')
    const b = readingBook(adapter, 'https://tomeshelf.wiloon.lab/read/1')
    expect(a?.bookKey).not.toBe(b?.bookKey)
  })

  it('gives different keys on different origins and ports', () => {
    setBook('same-id')
    const a = readingBook(adapter, 'https://a.example/read/1')
    const b = readingBook(adapter, 'https://b.example/read/1')
    const c = readingBook(adapter, 'https://a.example:8443/read/1')
    expect(a?.bookKey).not.toBe(b?.bookKey)
    expect(a?.bookKey).not.toBe(c?.bookKey)
  })

  it.each([
    "id/with?query#frag&eq=val%20+space'",
    'id with spaces',
    '书名-非ASCII',
  ])('keeps special characters in the book id unchanged (%s)', id => {
    setBook(id)
    const book = readingBook(adapter, 'https://tomeshelf.example/read/1')
    expect(book?.bookKey).toContain('enx-tomeshelf-book=')
    const parsed = new URL(book!.bookKey)
    expect(parsed.searchParams.get('enx-tomeshelf-book')).toBe(id)
    expect(checkAnchor(book!.bookKey, sampleAnchor(book!.sourceUrl)).ok).toBe(
      true
    )
  })

  it('falls back to the page address when the meta is missing or empty', () => {
    setBook(null)
    expect(
      readingBook(adapter, 'https://tomeshelf.example/books/x/read/1#ch')
    ).toEqual({
      bookKey: 'https://tomeshelf.example/books/x/read/1',
      sourceUrl: 'https://tomeshelf.example/books/x/read/1',
    })
    setBook('   ')
    expect(
      readingBook(adapter, 'https://tomeshelf.example/books/x/read/1')
    ).toEqual({
      bookKey: 'https://tomeshelf.example/books/x/read/1',
      sourceUrl: 'https://tomeshelf.example/books/x/read/1',
    })
  })
})
