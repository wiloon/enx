import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { ZyteDataset, ZYTE_COMMIT } from '../../article-eval/zyte.ts'

test('downloads pinned labels and snapshots once, then works from cache', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'enx-dataset-test-'))
  const requests = []
  const fetchFile = async url => {
    requests.push(url)
    return new Response(
      url.endsWith('ground-truth.json')
        ? JSON.stringify({
            story: {
              url: 'https://example.org/story',
              articleBody: 'Label text',
            },
          })
        : gzipSync('<article>Snapshot text</article>')
    )
  }
  try {
    const loader = new ZyteDataset({ cacheRoot, fetchFile })
    const expected = [
      {
        id: 'story',
        url: 'https://example.org/story',
        html: '<article>Snapshot text</article>',
        labelText: 'Label text',
      },
    ]
    assert.deepEqual(await loader.load(), expected)
    assert.equal(requests.length, 2)
    assert.ok(requests.every(url => url.includes(`/${ZYTE_COMMIT}/`)))
    const cached = new ZyteDataset({
      cacheRoot,
      fetchFile: () => {
        throw new Error('network forbidden')
      },
    })
    assert.deepEqual(await cached.load(), expected)
  } finally {
    await rm(cacheRoot, { recursive: true, force: true })
  }
})
