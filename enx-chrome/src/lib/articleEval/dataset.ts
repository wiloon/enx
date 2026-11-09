/** A labelled snapshot, independent of its dataset's storage format. */
export interface DatasetItem {
  id: string
  url: string
  html: string
  labelText: string
}

export interface DatasetLoader {
  load(): Promise<DatasetItem[]>
}

/** Zyte ground-truth.json maps snapshot IDs to human-labelled article bodies. */
export function parseZyteLabels(data: unknown): Omit<DatasetItem, 'html'>[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid Zyte ground truth: expected an object')
  }
  return Object.entries(data).map(([id, value]) => {
    const entry = value as { url?: unknown; articleBody?: unknown } | null
    if (
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      !entry ||
      typeof entry.url !== 'string' ||
      !/^https?:\/\//.test(entry.url) ||
      typeof entry.articleBody !== 'string'
    )
      throw new Error(`Invalid Zyte ground truth entry: ${id}`)
    return { id, url: entry.url, labelText: entry.articleBody }
  })
}
