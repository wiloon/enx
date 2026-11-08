import {
  compareBaseline,
  comparableBaseline,
  toBaseline,
  type Baseline,
} from '../baseline'

const OK = { verdict: 'ok', coverage: 0.95, precision: 0.9 } as const

describe('toBaseline', () => {
  it('records the platform, null for a non-platform result, and rounds the scores', () => {
    const page = {
      category: 'blog',
      adapter: 'default',
      source: 'article',
      verdict: 'ok',
      coverage: 0.98765,
      precision: 0.91234,
    } as const

    expect(
      toBaseline([
        {
          ...page,
          url: 'https://a.example/wp',
          selector: '.entry-content',
          platform: 'wordpress',
        },
        {
          ...page,
          url: 'https://a.example/plain',
          selector: 'article',
          platform: null,
        },
      ])
    ).toEqual({
      'https://a.example/wp': {
        category: 'blog',
        adapter: 'default',
        selector: '.entry-content',
        platform: 'wordpress',
        source: 'article',
        verdict: 'ok',
        coverage: 0.988,
        precision: 0.912,
      },
      'https://a.example/plain': {
        category: 'blog',
        adapter: 'default',
        selector: 'article',
        platform: null,
        source: 'article',
        verdict: 'ok',
        coverage: 0.988,
        precision: 0.912,
      },
    })
  })
})

describe('comparableBaseline', () => {
  const baseline: Baseline = {
    'https://a.example/1': OK,
    'https://a.example/gone': OK,
  }
  const current: Baseline = { 'https://a.example/1': OK }

  it('keeps every entry on a full run, so a removed page is reported', () => {
    const changes = compareBaseline(
      comparableBaseline(baseline, current, false),
      current
    )

    expect(changes.map(c => [c.url, c.change])).toEqual([
      ['https://a.example/gone', 'removed'],
    ])
  })

  it('keeps only the measured pages on a partial run', () => {
    expect(comparableBaseline(baseline, current, true)).toEqual({
      'https://a.example/1': OK,
    })
  })
})

describe('compareBaseline', () => {
  it('lists nothing when every page is unchanged', () => {
    const baseline: Baseline = { 'https://a.example/1': OK }

    expect(compareBaseline(baseline, { 'https://a.example/1': OK })).toEqual([])
  })

  it('compares an entry recorded before the platform field existed', () => {
    const recorded = {
      'https://a.example/1': {
        category: 'blog',
        adapter: 'default',
        selector: 'article',
        source: 'article',
        ...OK,
      },
    }
    const current = toBaseline([
      {
        url: 'https://a.example/1',
        category: 'blog',
        adapter: 'default',
        selector: 'article',
        platform: null,
        source: 'article',
        ...OK,
      },
    ])

    expect(compareBaseline(recorded, current)).toEqual([])
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
