import { formatDatasetReport } from '../report'

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
