import { homedir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  parseZyteLabels,
  type DatasetItem,
  type DatasetLoader,
} from '../src/lib/articleEval/dataset.ts'
import { cachedDownloader } from './cache.ts'

export const ZYTE_COMMIT = '4a3bc979f76c0df73cb95fe272e2fc1b96f9f010'
const SOURCE = `https://raw.githubusercontent.com/scrapinghub/article-extraction-benchmark/${ZYTE_COMMIT}`

/** Downloads only into the external cache; partial downloads are never reused. */
export class ZyteDataset implements DatasetLoader {
  private cached: (file: string) => Promise<Buffer>

  constructor({
    cacheRoot = join(homedir(), '.cache/enx/article-eval'),
    fetchFile = fetch,
  } = {}) {
    this.cached = cachedDownloader({
      name: 'Zyte',
      source: SOURCE,
      directory: join(cacheRoot, 'zyte', ZYTE_COMMIT),
      fetchFile,
      validate: (file, data) => {
        if (file.endsWith('.gz')) gunzipSync(data)
        else parseZyteLabels(JSON.parse(data.toString('utf8')))
      },
    })
  }

  async load(): Promise<DatasetItem[]> {
    const labels = parseZyteLabels(
      JSON.parse((await this.cached('ground-truth.json')).toString('utf8'))
    )
    const items: DatasetItem[] = []
    for (const label of labels) {
      const html = gunzipSync(
        await this.cached(`html/${label.id}.html.gz`)
      ).toString('utf8')
      items.push({ ...label, html })
    }
    return items
  }
}
