import { formatDatasetReport, type DatasetReport } from '../report'

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
