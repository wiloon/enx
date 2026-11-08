import { formatReport, summarize, type PageReport } from '../report'

const row = (overrides: Partial<PageReport>): PageReport => ({
  url: 'https://a.example/1',
  category: 'news',
  adapter: 'default',
  selector: 'article',
  platform: null,
  source: 'article',
  coverage: 0.9,
  precision: 0.8,
  verdict: 'ok',
  ...overrides,
})

const ROWS: PageReport[] = [
  row({ url: 'https://a.example/1' }),
  row({
    url: 'https://a.example/2',
    coverage: 0.5,
    precision: 1,
    verdict: 'misses text',
  }),
  row({
    url: 'https://a.example/3',
    selector: null,
    source: 'whole-page',
    coverage: 0,
    precision: null,
    verdict: 'whole page',
  }),
  row({
    url: 'https://b.example/1',
    category: 'docs',
    coverage: null,
    precision: null,
    verdict: 'no reference',
  }),
  row({
    url: 'https://b.example/2',
    category: 'docs',
    adapter: null,
    selector: null,
    source: null,
    coverage: null,
    precision: null,
    verdict: 'load failed',
    error: 'HTTP 403',
  }),
]

describe('summarize', () => {
  it('counts every verdict, including no reference and load failed', () => {
    expect(summarize(ROWS).verdicts).toEqual({
      ok: 1,
      'misses text': 1,
      'too broad': 0,
      'whole page': 1,
      'no article node': 0,
      'no reference': 1,
      'load failed': 1,
    })
  })

  it('averages scores over scored pages only and reports the scored count', () => {
    const summary = summarize(ROWS)

    expect(summary.total).toBe(5)
    expect(summary.scored).toBe(2)
    expect(summary.meanCoverage).toBeCloseTo(0.7)
    expect(summary.meanPrecision).toBeCloseTo(0.9)
  })

  it('breaks the counts down per category', () => {
    const docs = summarize(ROWS).categories.find(c => c.category === 'docs')!

    expect(docs.total).toBe(2)
    expect(docs.scored).toBe(0)
    expect(docs.meanCoverage).toBeNull()
    expect(docs.meanPrecision).toBeNull()
    expect(docs.verdicts['no reference']).toBe(1)
    expect(docs.verdicts['load failed']).toBe(1)
  })
})

describe('formatReport', () => {
  it('prints unavailable scores as n/a, never as a number', () => {
    const report = formatReport(ROWS, null)
    const noReference = report
      .split('\n')
      .find(line => line.includes('https://b.example/1'))!

    expect(noReference).toMatch(/n\/a.*n\/a.*no reference/)
  })

  it('prints the platform that found the article, and - for a non-platform result', () => {
    const lines = formatReport(
      [
        row({
          url: 'https://c.example/wp',
          selector: '.entry-content',
          platform: 'wordpress',
        }),
        row({ url: 'https://c.example/plain' }),
      ],
      null
    ).split('\n')
    const line = (url: string) => lines.find(l => l.includes(url))!

    expect(lines[0]).toMatch(/ADAPTER\/SELECTOR\s+PLATFORM\s+SOURCE/)
    expect(line('https://c.example/wp')).toMatch(
      /default \.entry-content\s+wordpress\s+article/
    )
    expect(line('https://c.example/plain')).toMatch(
      /default article\s+-\s+article/
    )
  })

  it('names why a page failed to load', () => {
    expect(formatReport(ROWS, null)).toContain('HTTP 403')
  })

  it('lists baseline changes after the table', () => {
    const report = formatReport(ROWS, [
      {
        url: 'https://a.example/2',
        change: 'verdict',
        before: { verdict: 'ok', coverage: 0.9, precision: 1 },
        after: { verdict: 'misses text', coverage: 0.5, precision: 1 },
      },
    ])

    expect(report).toMatch(
      /https:\/\/a\.example\/2.*ok 0\.90\/1\.00 -> misses text 0\.50\/1\.00/
    )
  })

  it('says so when nothing changed since the baseline', () => {
    expect(formatReport(ROWS, [])).toContain('No changes since the baseline')
  })
})
