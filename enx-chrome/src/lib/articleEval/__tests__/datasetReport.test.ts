import {
  formatDatasetReport,
  formatNonArticleReport,
  type DatasetReport,
} from '../report'

test('reports both extractors against labels with separate summary means', () => {
  const report = formatDatasetReport([
    {
      id: 'one',
      url: 'https://example.org/one',
      ours: { coverage: 1, precision: 0.5, verdict: 'too broad' },
      readability: { coverage: 0.5, precision: 1, verdict: 'misses text' },
    },
    {
      id: 'two',
      url: 'https://example.org/two',
      ours: { coverage: 0, precision: null, verdict: 'whole page' },
      readability: { coverage: 0, precision: 0, verdict: 'no article node' },
    },
  ])
  expect(report).toMatch(
    /OUR COVERAGE\s+OUR PRECISION\s+OUR VERDICT\s+READABILITY COVERAGE\s+READABILITY PRECISION\s+READABILITY VERDICT/
  )
  expect(report).toMatch(
    /one\s+https:\/\/example.org\/one\s+1.00\s+0.50\s+too broad\s+0.50\s+1.00\s+misses text/
  )
  expect(report).toContain(
    'Ours: 2 pages, 1 scored, mean coverage 1.00, mean precision 0.50'
  )
  expect(report).toContain(
    'Readability: 2 pages, 2 scored, mean coverage 0.25, mean precision 0.50'
  )
})

const failed = {
  coverage: null,
  precision: null,
  verdict: 'load failed',
} as const

test('untyped rows keep the Zyte report exactly as it was', () => {
  expect(
    formatDatasetReport([
      {
        id: 'one',
        url: 'https://example.org/one',
        ours: { coverage: 1, precision: 0.5, verdict: 'too broad' },
        readability: { coverage: 0.5, precision: 1, verdict: 'misses text' },
      },
      {
        id: 'two',
        url: 'https://example.org/two',
        ours: failed,
        readability: failed,
        error: 'timeout',
      },
    ])
  ).toBe(
    [
      'ID   URL                      OUR COVERAGE  OUR PRECISION  OUR VERDICT  READABILITY COVERAGE  READABILITY PRECISION  READABILITY VERDICT',
      'one  https://example.org/one  1.00          0.50           too broad    0.50                  1.00                   misses text',
      'two  https://example.org/two  n/a           n/a            load failed  n/a                   n/a                    load failed',
      '',
      'Ours: 2 pages, 1 scored, mean coverage 1.00, mean precision 0.50; ok 0, misses text 0, too broad 1, whole page 0, no article node 0, no reference 0, load failed 1',
      'Readability: 2 pages, 1 scored, mean coverage 0.50, mean precision 1.00; ok 0, misses text 1, too broad 0, whole page 0, no article node 0, no reference 0, load failed 1',
      'Unmeasured: two https://example.org/two (timeout)',
    ].join('\n')
  )
})

test('typed rows get a page type column and a summary per type for each extractor', () => {
  const rows: DatasetReport[] = [
    {
      id: '0001',
      url: 'https://a.example/story',
      pageType: 'article',
      ours: { coverage: 1, precision: 1, verdict: 'ok' },
      readability: { coverage: 0.5, precision: 1, verdict: 'misses text' },
    },
    {
      id: '4011',
      url: 'https://c.example/docs',
      pageType: 'documentation',
      ours: { coverage: 0.5, precision: 0.5, verdict: 'misses text' },
      readability: { coverage: 1, precision: 0.8, verdict: 'ok' },
    },
    {
      id: '0003',
      url: 'https://d.example/story',
      pageType: 'article',
      ours: failed,
      readability: failed,
      error: 'timeout',
    },
  ]
  const lines = formatDatasetReport(rows).split('\n')
  expect(lines[0]).toMatch(/^ID\s+URL\s+PAGE TYPE\s+OUR COVERAGE/)
  expect(lines[2]).toMatch(
    /^4011\s+https:\/\/c.example\/docs\s+documentation\s+0.50/
  )
  expect(lines.slice(5)).toEqual([
    'Ours: 3 pages, 2 scored, mean coverage 0.75, mean precision 0.75; ok 1, misses text 1, too broad 0, whole page 0, no article node 0, no reference 0, load failed 1',
    'Readability: 3 pages, 2 scored, mean coverage 0.75, mean precision 0.90; ok 1, misses text 1, too broad 0, whole page 0, no article node 0, no reference 0, load failed 1',
    'article: Ours: 2 pages, 1 scored, mean coverage 1.00, mean precision 1.00; ok 1, misses text 0, too broad 0, whole page 0, no article node 0, no reference 0, load failed 1',
    'article: Readability: 2 pages, 1 scored, mean coverage 0.50, mean precision 1.00; ok 0, misses text 1, too broad 0, whole page 0, no article node 0, no reference 0, load failed 1',
    'documentation: Ours: 1 pages, 1 scored, mean coverage 0.50, mean precision 0.50; ok 0, misses text 1, too broad 0, whole page 0, no article node 0, no reference 0, load failed 0',
    'documentation: Readability: 1 pages, 1 scored, mean coverage 1.00, mean precision 0.80; ok 1, misses text 0, too broad 0, whole page 0, no article node 0, no reference 0, load failed 0',
    'Unmeasured: 0003 https://d.example/story article (timeout)',
  ])
})

describe('formatNonArticleReport', () => {
  const none = { coverage: null, precision: null, verdict: 'no reference' } as const
  const page = (
    id: string,
    pageType: string,
    found: Partial<DatasetReport>
  ): DatasetReport => ({
    id,
    url: `https://example.org/${id}`,
    pageType,
    ours: none,
    readability: none,
    ...found,
  })

  it('counts, per page type, the pages given an article node and lists layer 6 ones', () => {
    expect(
      formatNonArticleReport([
        page('1', 'listing', { source: 'article' }),
        page('2', 'listing', {
          source: 'article',
          fallback: 'json-ld-readability',
        }),
        page('3', 'listing', { source: 'whole-page' }),
        page('4', 'forum', { source: 'whole-page' }),
        { ...page('5', 'forum', {}), url: '', error: 'no URL' },
        {
          ...page('6', 'forum', {}),
          ours: { coverage: null, precision: null, verdict: 'load failed' },
          error: 'timeout',
        },
      ])
    ).toBe(
      [
        'listing: 3 pages, 3 measured, 0 unmeasured; selector node 1, layer 6 node 1, whole page 1',
        'forum: 3 pages, 1 measured, 2 unmeasured; selector node 0, layer 6 node 0, whole page 1',
        'All: 6 pages, 4 measured, 2 unmeasured; selector node 1, layer 6 node 1, whole page 2',
        '',
        'Layer 6 nodes (1):',
        '  2  https://example.org/2  listing',
        'Unmeasured: 5 (no URL) forum',
        'Unmeasured: 6 https://example.org/6 forum (timeout)',
      ].join('\n')
    )
  })
})

test('sums up the verdicts of the pages layer 6 found', () => {
  const report = formatDatasetReport([
    {
      id: 'one',
      url: 'https://example.org/one',
      source: 'article',
      fallback: 'json-ld-readability',
      ours: { coverage: 0.9, precision: 0.9, verdict: 'ok' },
      readability: { coverage: 0.9, precision: 0.9, verdict: 'ok' },
    },
    {
      id: 'two',
      url: 'https://example.org/two',
      source: 'article',
      fallback: 'json-ld-readability',
      ours: { coverage: 0.9, precision: 0.5, verdict: 'too broad' },
      readability: { coverage: 0.9, precision: 0.9, verdict: 'ok' },
    },
    {
      id: 'three',
      url: 'https://example.org/three',
      source: 'article',
      ours: { coverage: 1, precision: 1, verdict: 'ok' },
      readability: { coverage: 1, precision: 1, verdict: 'ok' },
    },
  ])
  expect(report).toContain(
    'Layer 6: 2 pages; ok 1, misses text 0, too broad 1'
  )
})

test('sums up what layer 6 cost, including pages where its node was rejected', () => {
  const ran = (id: string, layer6Ms: number): DatasetReport => ({
    id,
    url: `https://example.org/${id}`,
    source: 'whole-page',
    layer6Ms,
    ours: { coverage: 1, precision: 0.1, verdict: 'whole page' },
    readability: { coverage: 1, precision: 1, verdict: 'ok' },
  })
  const rows = [ran('one', 2.4), ran('two', 15.6)]
  const line = 'Layer 6 ran on 2 pages: p50 2 ms, p90 16 ms, max 16 ms'
  expect(formatDatasetReport(rows)).toContain(line)
  expect(formatNonArticleReport(rows)).toContain(line)
})

test('says nothing about layer 6 when no page used it', () => {
  expect(
    formatDatasetReport([
      {
        id: 'one',
        url: 'https://example.org/one',
        source: 'article',
        ours: { coverage: 1, precision: 1, verdict: 'ok' },
        readability: { coverage: 1, precision: 1, verdict: 'ok' },
      },
    ])
  ).not.toContain('Layer 6')
})
