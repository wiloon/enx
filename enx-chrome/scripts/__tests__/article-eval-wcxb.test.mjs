import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { WcxbDataset, WCXB_COMMIT } from '../../article-eval/wcxb.ts'

const metadata = files => JSON.stringify({ total: 3, files })

const groundTruth = (url, mainContent, pageType) =>
  JSON.stringify({
    url,
    ground_truth: { title: 'Title', main_content: mainContent },
    _internal: { page_type: { primary: pageType, confidence: 0.9 } },
  })

const INDEX = {
  '0001': { split: 'dev', page_type: 'article', domain: 'a.example' },
  '0002': { split: 'dev', page_type: 'product', domain: 'b.example' },
  4011: { split: 'test', page_type: 'documentation', domain: 'c.example' },
}

function fakeDataset(overrides = {}) {
  const files = {
    'metadata.json': metadata(INDEX),
    'dev/ground-truth/0001.json': groundTruth(
      'https://a.example/story',
      'Article label',
      'article'
    ),
    'dev/html/0001.html.gz': gzipSync('<article>Story</article>'),
    'dev/ground-truth/0002.json': groundTruth(
      'https://b.example/shop',
      'Product label',
      'product'
    ),
    'dev/html/0002.html.gz': gzipSync('<main>Shop</main>'),
    'test/ground-truth/4011.json': groundTruth(
      'https://c.example/docs',
      'Docs label',
      'documentation'
    ),
    'test/html/4011.html.gz': gzipSync('<main>Docs</main>'),
    ...overrides,
  }
  const requests = []
  const prefix = `https://raw.githubusercontent.com/Murrough-Foley/web-content-extraction-benchmark/${WCXB_COMMIT}/`
  const fetchFile = async url => {
    requests.push(url)
    assert.ok(url.startsWith(prefix), url)
    const body = files[url.slice(prefix.length)]
    return body === undefined
      ? new Response('missing', { status: 404 })
      : new Response(body)
  }
  return { requests, fetchFile }
}

async function withCache(run) {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'enx-wcxb-test-'))
  try {
    await run(cacheRoot)
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
}

async function cachedFiles(cacheRoot) {
  const directory = join(cacheRoot, 'wcxb', WCXB_COMMIT)
  try {
    return (await readdir(directory, { recursive: true })).sort()
  } catch {
    return []
  }
}

test('loads only article and documentation pages from the pinned commit, then from cache', async () => {
  await withCache(async cacheRoot => {
    const { requests, fetchFile } = fakeDataset()
    const expected = [
      {
        id: '0001',
        url: 'https://a.example/story',
        html: '<article>Story</article>',
        labelText: 'Article label',
        pageType: 'article',
      },
      {
        id: '4011',
        url: 'https://c.example/docs',
        html: '<main>Docs</main>',
        labelText: 'Docs label',
        pageType: 'documentation',
      },
    ]
    assert.deepEqual(
      await new WcxbDataset({ cacheRoot, fetchFile }).load(),
      expected
    )
    assert.equal(requests.length, 5)
    assert.ok(requests.every(url => url.includes(`/${WCXB_COMMIT}/`)))
    assert.ok(requests.every(url => !url.includes('0002')))
    const cached = new WcxbDataset({
      cacheRoot,
      fetchFile: () => {
        throw new Error('network forbidden')
      },
    })
    assert.deepEqual(await cached.load(), expected)
  })
})

test('keeps a page whose label is empty so the report can show it as unmeasured', async () => {
  await withCache(async cacheRoot => {
    const { fetchFile } = fakeDataset({
      'dev/ground-truth/0001.json': groundTruth(
        'https://a.example/story',
        '  \n ',
        'article'
      ),
    })
    const items = await new WcxbDataset({ cacheRoot, fetchFile }).load()
    assert.deepEqual(
      items.map(({ id, labelText, pageType }) => ({ id, labelText, pageType })),
      [
        { id: '0001', labelText: '  \n ', pageType: 'article' },
        { id: '4011', labelText: 'Docs label', pageType: 'documentation' },
      ]
    )
  })
})

for (const [name, url] of [
  ['an empty', ''],
  ['a missing', undefined],
  ['a non-HTTP', 'ftp://a.example/story'],
]) {
  test(`keeps a page with ${name} URL with no URL so the report lists it as unmeasured`, async () => {
    await withCache(async cacheRoot => {
      const { fetchFile } = fakeDataset({
        'dev/ground-truth/0001.json': groundTruth(url, 'Label', 'article'),
      })
      const items = await new WcxbDataset({ cacheRoot, fetchFile }).load()
      assert.equal(items[0].id, '0001')
      assert.equal(items[0].url, '')
      assert.equal(items[1].url, 'https://c.example/docs')
    })
  })
}

const rejected = [
  ['metadata that is not JSON', { 'metadata.json': '{"files": ' }, /JSON/],
  [
    'metadata without a files object',
    { 'metadata.json': JSON.stringify({ files: [] }) },
    /Invalid WCXB metadata/,
  ],
  [
    'an ID outside digits',
    {
      'metadata.json': metadata({
        '../0001': { split: 'dev', page_type: 'article' },
      }),
    },
    /Invalid WCXB metadata entry: \.\.\/0001/,
  ],
  [
    'an unknown split',
    {
      'metadata.json': metadata({
        '0001': { split: 'train', page_type: 'article' },
      }),
    },
    /Invalid WCXB metadata entry: 0001/,
  ],
  [
    'an entry without a page type',
    { 'metadata.json': metadata({ '0001': { split: 'dev' } }) },
    /Invalid WCXB metadata entry: 0001/,
  ],
  [
    'a non-string label',
    {
      'dev/ground-truth/0001.json': groundTruth(
        'https://a.example/story',
        null,
        'article'
      ),
    },
    /Invalid WCXB ground truth dev\/ground-truth\/0001\.json/,
  ],
  [
    'a page type that disagrees with the index',
    {
      'dev/ground-truth/0001.json': groundTruth(
        'https://a.example/story',
        'Label',
        'forum'
      ),
    },
    /WCXB 0001: page type forum in ground truth, article in metadata\.json/,
  ],
  [
    'a snapshot that is not gzip',
    { 'dev/html/0001.html.gz': '<article>plain</article>' },
    /header|incorrect/i,
  ],
]

for (const [name, overrides, message] of rejected) {
  test(`fails the load on ${name}`, async () => {
    await withCache(async cacheRoot => {
      const { fetchFile } = fakeDataset(overrides)
      await assert.rejects(
        new WcxbDataset({ cacheRoot, fetchFile }).load(),
        message
      )
      const files = await cachedFiles(cacheRoot)
      for (const file of Object.keys(overrides)) {
        // A mismatching page type is a valid file; the load fails on the pair.
        if (name.includes('disagrees')) continue
        assert.ok(!files.includes(file), `${file} entered the cache`)
      }
      assert.ok(!files.some(file => file.endsWith('.tmp')))
    })
  })
}
