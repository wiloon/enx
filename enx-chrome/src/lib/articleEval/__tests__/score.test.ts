import { scorePage } from '../score'

const words = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ')

const REFERENCE = words('story', 400)

const article = (chosenText: string, referenceText: string | null) =>
  scorePage({
    status: 'loaded',
    source: 'article',
    nodes: 1,
    chosenText,
    referenceText,
  })

describe('scorePage', () => {
  it('scores identical texts 1/1 and ok', () => {
    expect(article(REFERENCE, REFERENCE)).toEqual({
      coverage: 1,
      precision: 1,
      verdict: 'ok',
    })
  })

  it('ignores case and whitespace differences', () => {
    const chosen = REFERENCE.toUpperCase().replaceAll(' ', '\n\t  ')
    expect(article(chosen, REFERENCE)).toEqual({
      coverage: 1,
      precision: 1,
      verdict: 'ok',
    })
  })

  it('scores a fragment of the reference as low coverage, high precision', () => {
    const fragment = words('story', 100)
    const score = article(fragment, REFERENCE)

    expect(score.coverage).toBeLessThan(0.3)
    expect(score.precision).toBe(1)
    expect(score.verdict).toBe('misses text')
  })

  it('scores the reference plus a long link list as high coverage, low precision', () => {
    const chosen = `${REFERENCE} ${words('link', 800)}`
    const score = article(chosen, REFERENCE)

    expect(score.coverage).toBe(1)
    expect(score.precision).toBeLessThan(0.4)
    expect(score.verdict).toBe('too broad')
  })

  it('calls both scores below threshold misses text', () => {
    const chosen = `${words('story', 100)} ${words('link', 800)}`
    const score = article(chosen, REFERENCE)

    expect(score.coverage).toBeLessThan(0.8)
    expect(score.precision).toBeLessThan(0.7)
    expect(score.verdict).toBe('misses text')
  })

  it('scores empty article nodes 0/0 and no article node', () => {
    expect(
      scorePage({
        status: 'loaded',
        source: 'article',
        nodes: 0,
        chosenText: '',
        referenceText: REFERENCE,
      })
    ).toEqual({ coverage: 0, precision: 0, verdict: 'no article node' })
  })

  it('reports no article node with unavailable scores when there is no reference either', () => {
    expect(
      scorePage({
        status: 'loaded',
        source: 'article',
        nodes: 0,
        chosenText: '',
        referenceText: null,
      })
    ).toEqual({ coverage: null, precision: null, verdict: 'no article node' })
  })

  it('scores a whole-page source coverage 0 and whole page', () => {
    expect(
      scorePage({
        status: 'loaded',
        source: 'whole-page',
        nodes: 1,
        chosenText: REFERENCE,
        referenceText: REFERENCE,
      })
    ).toEqual({ coverage: 0, precision: null, verdict: 'whole page' })
  })

  it.each([
    ['missing', null],
    ['empty', '  \n '],
  ])('reports no reference for a %s reference', (_name, referenceText) => {
    expect(article(REFERENCE, referenceText)).toEqual({
      coverage: null,
      precision: null,
      verdict: 'no reference',
    })
  })

  it('reports load failed with unavailable scores', () => {
    expect(scorePage({ status: 'load-failed', error: 'timeout' })).toEqual({
      coverage: null,
      precision: null,
      verdict: 'load failed',
    })
  })

  it('compares texts shorter than one shingle as a whole', () => {
    expect(article('Hello world', 'hello   WORLD')).toEqual({
      coverage: 1,
      precision: 1,
      verdict: 'ok',
    })
  })
})
