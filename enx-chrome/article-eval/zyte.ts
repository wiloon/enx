import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
  parseZyteLabels,
  type DatasetItem,
  type DatasetLoader,
} from '../src/lib/articleEval/dataset.ts'

export const ZYTE_COMMIT = '4a3bc979f76c0df73cb95fe272e2fc1b96f9f010'
const SOURCE = `https://raw.githubusercontent.com/scrapinghub/article-extraction-benchmark/${ZYTE_COMMIT}`

/** Downloads only into the external cache; partial downloads are never reused. */
export class ZyteDataset implements DatasetLoader {
  private directory: string
  private fetchFile: typeof fetch

  constructor({
    cacheRoot = join(homedir(), '.cache/enx/article-eval'),
    fetchFile = fetch,
  } = {}) {
    this.directory = join(cacheRoot, 'zyte', ZYTE_COMMIT)
    this.fetchFile = fetchFile
  }

  private async cached(file: string): Promise<Buffer> {
    const target = join(this.directory, file)
    try {
      return await readFile(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const response = await this.fetchFile(`${SOURCE}/${file}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Zyte ${file}: HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    // Reject incomplete or malformed files before they enter the cache.
    if (file.endsWith('.gz')) gunzipSync(data)
    else parseZyteLabels(JSON.parse(data.toString('utf8')))
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, data)
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
    }
    return data
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
