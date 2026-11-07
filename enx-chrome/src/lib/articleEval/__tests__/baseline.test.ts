import { compareBaseline, type Baseline } from '../baseline'

const OK = { verdict: 'ok', coverage: 0.95, precision: 0.9 } as const

describe('compareBaseline', () => {
  it('lists nothing when every page is unchanged', () => {
    const baseline: Baseline = { 'https://a.example/1': OK }

    expect(compareBaseline(baseline, { 'https://a.example/1': OK })).toEqual([])
  })

  it('ignores score moves within the tolerance', () => {
    expect(
      compareBaseline(
        { 'https://a.example/1': OK },
        { 'https://a.example/1': { ...OK, coverage: 0.93, precision: 0.92 } }
      )
    ).toEqual([])
  })

  it('lists a page whose verdict changed', () => {
    const after = {
      verdict: 'whole page',
      coverage: 0,
      precision: null,
    } as const

    expect(
      compareBaseline(
        { 'https://a.example/1': OK },
        { 'https://a.example/1': after }
      )
    ).toEqual([
      { url: 'https://a.example/1', change: 'verdict', before: OK, after },
    ])
  })

  it('lists a page whose score moved past the tolerance', () => {
    const after = { ...OK, precision: 0.8 }

    expect(
      compareBaseline(
        { 'https://a.example/1': OK },
        { 'https://a.example/1': after }
      )
    ).toEqual([
      { url: 'https://a.example/1', change: 'scores', before: OK, after },
    ])
  })

  it('lists a score that became unavailable', () => {
    const before = {
      verdict: 'misses text',
      coverage: 0.5,
      precision: 0.9,
    } as const
    const after = {
      verdict: 'misses text',
      coverage: 0.5,
      precision: null,
    } as const

    expect(
      compareBaseline(
        { 'https://a.example/1': before },
        { 'https://a.example/1': after }
      )
    ).toEqual([{ url: 'https://a.example/1', change: 'scores', before, after }])
  })

  it('lists a page added since the baseline', () => {
    expect(compareBaseline({}, { 'https://a.example/new': OK })).toEqual([
      {
        url: 'https://a.example/new',
        change: 'added',
        before: null,
        after: OK,
      },
    ])
  })

  it('lists a page removed since the baseline', () => {
    expect(compareBaseline({ 'https://a.example/old': OK }, {})).toEqual([
      {
        url: 'https://a.example/old',
        change: 'removed',
        before: OK,
        after: null,
      },
    ])
  })
})
