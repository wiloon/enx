import type { DatasetReport } from './report'
import type { Score } from './score'

/** A labelled snapshot, independent of its dataset's storage format. */
export interface DatasetItem {
  id: string
  url: string
  html: string
  labelText: string
  /** The dataset's page type, when it labels one. */
  pageType?: string
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

/**
 * The WCXB page types measured. Product, collection, listing and service
 * pages aren't articles; forum pages are left out for now.
 */
export const WCXB_PAGE_TYPES: readonly string[] = ['article', 'documentation']

export interface WcxbIndexEntry {
  id: string
  split: 'dev' | 'test'
  pageType: string
}

/**
 * WCXB metadata.json: `files` maps page IDs to their split and page type.
 * Entries come back in ID order.
 */
export function parseWcxbIndex(data: unknown): WcxbIndexEntry[] {
  const files = (data as { files?: unknown } | null)?.files
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('Invalid WCXB metadata: expected a files object')
  }
  const entries = Object.entries(files).map(([id, value]): WcxbIndexEntry => {
    const entry = value as { split?: unknown; page_type?: unknown } | null
    if (
      !/^\d+$/.test(id) ||
      !entry ||
      (entry.split !== 'dev' && entry.split !== 'test') ||
      typeof entry.page_type !== 'string'
    )
      throw new Error(`Invalid WCXB metadata entry: ${id}`)
    return { id, split: entry.split, pageType: entry.page_type }
  })
  return entries.sort((a, b) => Number(a.id) - Number(b.id))
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/** One WCXB `<split>/ground-truth/<id>.json`; `file` names it in errors. */
export function parseWcxbGroundTruth(
  file: string,
  data: unknown
): { url: string; labelText: string; pageType: string } {
  const page = data as {
    url?: unknown
    ground_truth?: { main_content?: unknown } | null
    _internal?: { page_type?: { primary?: unknown } | null } | null
  } | null
  const labelText = page?.ground_truth?.main_content ?? ''
  const pageType = page?._internal?.page_type?.primary
  if (typeof labelText !== 'string' || typeof pageType !== 'string')
    throw new Error(`Invalid WCXB ground truth ${file}`)
  // A missing or non-http(s) URL is a gap in the dataset, not a broken file:
  // the page loads with an empty URL and is reported unmeasured.
  return { url: isHttpUrl(page?.url) ? page.url : '', labelText, pageType }
}

/** Why a page with an empty URL is unmeasured; the report words it itself. */
const NO_URL = 'no URL'

const UNMEASURED: Score = {
  coverage: null,
  precision: null,
  verdict: 'no reference',
}

/**
 * Evaluates every item with `evaluate`, a few at a time, in item order. A
 * label with no text measures nothing, so its page is reported unmeasured
 * and never evaluated.
 */
export async function measureDataset(
  items: DatasetItem[],
  evaluate: (item: DatasetItem) => Promise<DatasetReport>,
  {
    concurrency = 3,
    onRow = () => {},
  }: {
    concurrency?: number
    onRow?: (row: DatasetReport, done: number) => void
  } = {}
): Promise<DatasetReport[]> {
  const rows: DatasetReport[] = new Array(items.length)
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const index = next++
        const item = items[index]
        rows[index] =
          item.url === '' || item.labelText.trim() === ''
            ? {
                id: item.id,
                url: item.url,
                pageType: item.pageType,
                ours: UNMEASURED,
                readability: UNMEASURED,
                error:
                  item.url === ''
                    ? NO_URL
                    : 'empty label, nothing to score',
              }
            : await evaluate(item)
        onRow(rows[index], ++done)
      }
    })
  )
  return rows
}
