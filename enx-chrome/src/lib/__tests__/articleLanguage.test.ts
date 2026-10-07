import {
  DEFAULT_HAN_CHAR_LIMIT,
  countHanChars,
  isChineseArticle,
  parseHanCharLimit,
} from '@/lib/articleLanguage'

describe('countHanChars', () => {
  it('counts Chinese characters and ignores Latin letters, digits and punctuation', () => {
    expect(countHanChars('Kubernetes 1.30 发布了，新功能')).toBe(6)
    expect(countHanChars('An English article, 100% Latin.')).toBe(0)
  })
})

describe('isChineseArticle', () => {
  const han = (n: number) => '字'.repeat(n)

  // An English article may gloss a name or a term in Chinese.
  it('keeps an English article with a few Chinese characters', () => {
    expect(isChineseArticle(`The word ${han(20)} means ...`, 20)).toBe(false)
  })

  it('skips an article with more Chinese characters than the limit', () => {
    expect(isChineseArticle(`Kubernetes ${han(21)}`, 20)).toBe(true)
  })

  it('with a limit of 0, any Chinese character skips the article', () => {
    expect(isChineseArticle(`An English article ${han(1)}`, 0)).toBe(true)
  })
})

describe('parseHanCharLimit', () => {
  it('defaults to 20 when unset or empty', () => {
    expect(DEFAULT_HAN_CHAR_LIMIT).toBe(20)
    expect(parseHanCharLimit(undefined)).toBe(20)
    expect(parseHanCharLimit('')).toBe(20)
  })

  it('accepts a non-negative integer', () => {
    expect(parseHanCharLimit('0')).toBe(0)
    expect(parseHanCharLimit(' 50 ')).toBe(50)
  })

  it('falls back to the default for anything else', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    for (const raw of ['-1', '2.5', 'abc', '20x']) {
      expect(parseHanCharLimit(raw)).toBe(20)
    }
  })
})
