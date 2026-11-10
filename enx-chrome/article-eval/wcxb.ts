import { homedir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  parseWcxbGroundTruth,
  parseWcxbIndex,
  WCXB_PAGE_TYPES,
  type DatasetItem,
  type DatasetLoader,
} from '../src/lib/articleEval/dataset.ts'
import { cachedDownloader } from './cache.ts'

export const WCXB_COMMIT = 'c039d5ee9f5a3a984a0e167e63aacd04e76e78a9'
const SOURCE = `https://raw.githubusercontent.com/Murrough-Foley/web-content-extraction-benchmark/${WCXB_COMMIT}`

const json = (data: Buffer): unknown => JSON.parse(data.toString('utf8'))

/**
 * WCXB pages of the given types (article and documentation by default) from
 * both splits, indexed by metadata.json so other page types are never
 * downloaded.
 */
export class WcxbDataset implements DatasetLoader {
  private cached: (file: string) => Promise<Buffer>
  private pageTypes: readonly string[]

  constructor({
    cacheRoot = join(homedir(), '.cache/enx/article-eval'),
    fetchFile = fetch,
    pageTypes = WCXB_PAGE_TYPES,
  } = {}) {
    this.pageTypes = pageTypes
    this.cached = cachedDownloader({
      name: 'WCXB',
      source: SOURCE,
      directory: join(cacheRoot, 'wcxb', WCXB_COMMIT),
      fetchFile,
      validate: (file, data) => {
        if (file.endsWith('.gz')) gunzipSync(data)
        else if (file === 'metadata.json') parseWcxbIndex(json(data))
        else parseWcxbGroundTruth(file, json(data))
      },
    })
  }

  async load(): Promise<DatasetItem[]> {
    const index = parseWcxbIndex(json(await this.cached('metadata.json')))
    const items: DatasetItem[] = []
    for (const { id, split, pageType } of index) {
      if (!this.pageTypes.includes(pageType)) continue
      const file = `${split}/ground-truth/${id}.json`
      const label = parseWcxbGroundTruth(file, json(await this.cached(file)))
      if (label.pageType !== pageType)
        throw new Error(
          `WCXB ${id}: page type ${label.pageType} in ground truth, ${pageType} in metadata.json`
        )
      const html = gunzipSync(
        await this.cached(`${split}/html/${id}.html.gz`)
      ).toString('utf8')
      items.push({
        id,
        url: label.url,
        html,
        labelText: label.labelText,
        pageType,
      })
    }
    return items
  }
}
