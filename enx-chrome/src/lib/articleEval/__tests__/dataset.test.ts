import { measureDataset, parseZyteLabels, type DatasetItem } from '../dataset'
import { formatDatasetReport } from '../report'

test('reports an empty label as unmeasured without evaluating the page', async () => {
  const items: DatasetItem[] = [
    {
      id: '0001',
      url: 'https://a.example/story',
      html: '<article>Story</article>',
      labelText: 'Story',
      pageType: 'article',
    },
    {
      id: '0002',
      url: 'https://a.example/blank',
      html: '<article>Blank</article>',
      labelText: ' \n\t',
      pageType: 'article',
    },
  ]
  const evaluated: string[] = []
  const rows = await measureDataset(items, async item => {
    evaluated.push(item.id)
    return {
      id: item.id,
      url: item.url,
      pageType: item.pageType,
      ours: { coverage: 1, precision: 1, verdict: 'ok' },
      readability: { coverage: 0.5, precision: 0.5, verdict: 'misses text' },
    }
  })

  expect(evaluated).toEqual(['0001'])
  expect(rows[1]).toMatchObject({
    id: '0002',
    url: 'https://a.example/blank',
    pageType: 'article',
    ours: { coverage: null, precision: null },
    readability: { coverage: null, precision: null },
    error: 'empty label, nothing to score',
  })
  const report = formatDatasetReport(rows)
  expect(report).toContain(
    'Ours: 2 pages, 1 scored, mean coverage 1.00, mean precision 1.00'
  )
  expect(report).toContain(
    'Readability: 2 pages, 1 scored, mean coverage 0.50, mean precision 0.50'
  )
  expect(report).toContain(
    'Unmeasured: 0002 https://a.example/blank article (empty label, nothing to score)'
  )
})

test('reports a page without a URL as unmeasured without evaluating it', async () => {
  const evaluated: string[] = []
  const rows = await measureDataset(
    [
      {
        id: '4129',
        url: '',
        html: '<article>Story</article>',
        labelText: 'Story',
        pageType: 'article',
      },
    ],
    async item => {
      evaluated.push(item.id)
      throw new Error('must not evaluate')
    }
  )
  expect(evaluated).toEqual([])
  expect(formatDatasetReport(rows)).toContain('Unmeasured: 4129 (no URL) article')
})

test('maps labelled snapshot IDs to URLs and human article text', () => {
  expect(
    parseZyteLabels({
      'story-1': {
        url: 'https://example.com/news',
        articleBody: 'The labelled article.',
      },
      'story-2': {
        url: 'http://example.org/story',
        articleBody: 'Another article.',
      },
    })
  ).toEqual([
    {
      id: 'story-1',
      url: 'https://example.com/news',
      labelText: 'The labelled article.',
    },
    {
      id: 'story-2',
      url: 'http://example.org/story',
      labelText: 'Another article.',
    },
  ])
})
