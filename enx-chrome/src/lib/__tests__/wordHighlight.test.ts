import { sentenceHighlightSpans, sentenceWordStates } from '@/lib/wordHighlight'
import { WordData } from '@/types'

const word = (
  english: string,
  overrides: Partial<WordData> = {}
): WordData => ({
  Key: english,
  English: english,
  Pronunciation: '',
  Chinese: '',
  LoadCount: 1,
  AlreadyAcquainted: 0,
  WordType: 0,
  ...overrides,
})

describe('sentenceHighlightSpans', () => {
  // "The cat sat on the mat"
  //  0123456789012345678901
  //  The=[0,3) cat=[4,7) sat=[8,11) on=[12,14) the=[15,18) mat=[19,22)
  const sentence = 'The cat sat on the mat'

  it('underlines a looked-up word in the bucket for its LoadCount', () => {
    const { buckets } = sentenceHighlightSpans(
      sentence,
      '',
      { cat: word('cat', { LoadCount: 4 }) },
      true
    )

    expect(buckets).toEqual(new Map([[2, [{ start: 4, end: 7 }]]]))
  })

  it('marks every occurrence of the anchor word, ignoring case', () => {
    const { anchor } = sentenceHighlightSpans(sentence, 'the', {}, true)

    expect(anchor).toEqual([
      { start: 0, end: 3 },
      { start: 15, end: 18 },
    ])
  })

  it('drops the underlines but keeps the anchor when the highlight preference is off', () => {
    const spans = sentenceHighlightSpans(
      sentence,
      'cat',
      { cat: word('cat') },
      false
    )

    expect(spans.buckets.size).toBe(0)
    expect(spans.anchor).toEqual([{ start: 4, end: 7 }])
  })

  it('does not underline acquainted, never-looked-up or unknown words', () => {
    const { buckets } = sentenceHighlightSpans(
      sentence,
      '',
      {
        cat: word('cat', { AlreadyAcquainted: 1 }),
        sat: word('sat', { LoadCount: 0 }),
      },
      true
    )

    expect(buckets.size).toBe(0)
  })

  it('underlines a hyphenated word as one token, keyed like the page wordCache', () => {
    const { buckets } = sentenceHighlightSpans(
      'A well-known fact',
      '',
      { 'well-known': word('well-known', { LoadCount: 30 }) },
      true
    )

    expect(buckets).toEqual(new Map([[5, [{ start: 2, end: 12 }]]]))
  })

  it('matches a capitalised occurrence against the lower-cased word state', () => {
    const { buckets } = sentenceHighlightSpans(
      sentence,
      '',
      { the: word('the') },
      true
    )

    expect(buckets).toEqual(
      new Map([
        [
          1,
          [
            { start: 0, end: 3 },
            { start: 15, end: 18 },
          ],
        ],
      ])
    )
  })
})

describe('sentenceWordStates', () => {
  it("picks the page wordCache entries for the sentence's words only", () => {
    const cat = word('cat')
    const wellKnown = word('well-known')

    const states = sentenceWordStates('The well-known Cat sat', {
      cat,
      'well-known': wellKnown,
      dog: word('dog'),
    })

    expect(states).toEqual({ cat, 'well-known': wellKnown })
  })
})
