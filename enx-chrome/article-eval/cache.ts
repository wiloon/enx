import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Returns a reader for `<source>/<file>` that downloads only into `directory`.
 * `validate` throws on an incomplete or malformed download, which then never
 * enters the cache; partial downloads are never reused.
 */
export function cachedDownloader({
  name,
  source,
  directory,
  fetchFile,
  validate,
}: {
  name: string
  source: string
  directory: string
  fetchFile: typeof fetch
  validate: (file: string, data: Buffer) => void
}): (file: string) => Promise<Buffer> {
  return async file => {
    const target = join(directory, file)
    try {
      return await readFile(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const response = await fetchFile(`${source}/${file}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok)
      throw new Error(`${name} ${file}: HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    validate(file, data)
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
}
