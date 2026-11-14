import { buildReadingAnchor, readingBook } from '@/lib/readingAnchor'

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
