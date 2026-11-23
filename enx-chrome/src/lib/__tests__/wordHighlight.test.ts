import {
  HIGHLIGHT_BUCKET_COLORS,
  hostPageHighlightCss,
  pageToneFromComputedColor,
  reviewBucketHighlightCss,
  sentenceHighlightSpans,
  sentenceWordStates,
  underlineColorsForTone,
  washColorsForTone,
} from '@/lib/wordHighlight'
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
  Known: false,
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

  it('does not underline known, never-looked-up or unknown words', () => {
    const { buckets } = sentenceHighlightSpans(
      sentence,
      '',
      {
        cat: word('cat', { Known: true }),
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

  // ADR-069: the review list holds "cat"; a possessive with either
  // apostrophe is the same word, as SetEnglishField has it on the server.
  it('maps possessives with either apostrophe to the word they belong to', () => {
    const cat = word('cat')

    expect(sentenceWordStates('The cat’s bowl and the cat\'s toy', { cat }))
      .toEqual({ cat })
  })
})

describe('sentence mapping shared with the page (ADR-069)', () => {
  it("underlines CAT's and cat’s for a list word cat", () => {
    const sentence = "CAT'S toy and the cat’s bowl"
    const { buckets } = sentenceHighlightSpans(
      sentence,
      '',
      { cat: word('cat', { LoadCount: 1 }) },
      true
    )

    expect(buckets).toEqual(
      new Map([
        [
          1,
          [
            { start: 0, end: 5 },
            { start: 18, end: 23 },
          ],
        ],
      ])
    )
  })

  it('keeps contractions as their own words', () => {
    const { buckets } = sentenceHighlightSpans(
      'It isn’t here',
      '',
      { "isn't": word("isn't") },
      true
    )

    expect([...buckets.values()].flat()).toEqual([{ start: 3, end: 8 }])
  })
})

// ADR-086 / #923: page tone from computed colour, and the light/dark palettes.
describe('pageToneFromComputedColor', () => {
  it.each([
    ['rgb(224, 224, 224)', 'dark'],
    ['rgb(176, 176, 176)', 'dark'],
    ['rgb(51, 51, 51)', 'light'],
    ['rgb(0, 0, 0)', 'light'],
  ] as const)('%s gives %s', (color, tone) => {
    expect(pageToneFromComputedColor(color)).toBe(tone)
  })

  it.each([
    ['rgba(224, 224, 224, 0.8)', 'dark'],
    ['rgb(224 224 224 / 50%)', 'dark'],
    ['rgba(255, 255, 255, 0)', 'light'],
    ['oklch(0.9 0 0)', 'light'],
    ['color(srgb 1 1 1)', 'light'],
    ['', 'light'],
    ['garbage', 'light'],
  ] as const)('%j gives %s without throwing', (color, tone) => {
    expect(pageToneFromComputedColor(color)).toBe(tone)
  })

  it('treats the luminance boundary: 117 is light, 118 is dark', () => {
    expect(pageToneFromComputedColor('rgb(117, 117, 117)')).toBe('light')
    expect(pageToneFromComputedColor('rgb(118, 118, 118)')).toBe('dark')
  })
})

describe('highlight palette by page tone (ADR-086)', () => {
  const LIGHT_UNDERLINES = [
    'oklch(0.45 0.13 305)',
    'oklch(0.53 0.13 305)',
    'oklch(0.61 0.12 305)',
    'oklch(0.69 0.1 305)',
    'oklch(0.77 0.08 305)',
  ]
  const LIGHT_WASHES = {
    activeSentenceWash: 'hsl(45 95% 55% / 35%)',
    clickedWordWash: 'hsl(45 95% 55% / 60%)',
    hoverSentenceWash: 'hsl(45 95% 55% / 20%)',
  }

  it('keeps the light palette equal to today so light pages are unchanged', () => {
    expect(underlineColorsForTone('light')).toEqual(LIGHT_UNDERLINES)
    expect(underlineColorsForTone('light')).toEqual([
      ...HIGHLIGHT_BUCKET_COLORS,
    ])
    expect(washColorsForTone('light')).toEqual(LIGHT_WASHES)
    expect(reviewBucketHighlightCss()).toBe(reviewBucketHighlightCss('light'))
  })

  it('orders dark underlines from lightest (bucket 1) to darkest (bucket 5)', () => {
    const lightness = (oklch: string) => {
      const m = /^oklch\(([\d.]+)/.exec(oklch)
      if (!m) throw new Error(`not oklch: ${oklch}`)
      return Number(m[1])
    }
    const dark = underlineColorsForTone('dark')
    expect(dark).toHaveLength(5)
    for (let i = 0; i < dark.length - 1; i++) {
      expect(lightness(dark[i])).toBeGreaterThan(lightness(dark[i + 1]))
    }
  })

  it.each(['light', 'dark'] as const)(
    'hostPageHighlightCss(%s) has one rule per bucket plus sentence and clicked-word washes',
    tone => {
      const css = hostPageHighlightCss(tone)
      const underlines = underlineColorsForTone(tone)
      const washes = washColorsForTone(tone)
      for (let i = 0; i < 5; i++) {
        expect(css).toContain(`::highlight(enx-hl-${i + 1})`)
        expect(css).toContain(underlines[i])
      }
      expect(css).toContain('::highlight(enx-active-sentence)')
      expect(css).toContain(washes.activeSentenceWash)
      expect(css).toContain('::highlight(enx-clicked-word)')
      expect(css).toContain(washes.clickedWordWash)
      expect(css).toContain('::highlight(enx-hover-sentence)')
      expect(css).toContain(washes.hoverSentenceWash)
    }
  )
})
