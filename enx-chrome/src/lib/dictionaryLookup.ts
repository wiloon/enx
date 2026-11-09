import type { BackgroundResponse, WordData } from '@/types'
import { countLookup } from '@/lib/queryCount'

export interface DictionaryLookupDeps {
  get: (word: string, refresh?: boolean) => Promise<BackgroundResponse>
  record: (wordId: string, fromCache: boolean) => Promise<BackgroundResponse>
  isActive: () => boolean
  isCurrent: () => boolean
  onDefinition: (word: WordData) => void
  onCounted: (word: WordData) => void
  onFailure: (response: BackgroundResponse) => void
}

// One shared decision flow for page clicks, panel clicks and read-only cards.
// Account changes discard all effects; a replaced popover only discards rendering.
export async function runDictionaryLookup(
  word: string,
  options: { counts: boolean; state?: WordData },
  deps: DictionaryLookupDeps
): Promise<WordData | undefined> {
  const response = await deps.get(word)
  if (!response.success || !response.ecp) {
    if (deps.isCurrent()) deps.onFailure(response)
    return
  }
  if (!deps.isActive()) return
  let data = response.ecp
  if (response.fromCache) {
    data = { ...data, LoadCount: undefined, Known: undefined }
  }
  if (!options.counts) {
    if (response.fromCache)
      data = {
        ...data,
        LoadCount: options.state?.LoadCount,
        Known: options.state?.Known,
      }
    if (deps.isCurrent()) deps.onDefinition(data)
    return data
  }
  if (!response.fromCache) {
    data = countLookup(data, id => {
      void deps.record(id, false).catch(() => {})
    })
    if (deps.isCurrent()) deps.onDefinition(data)
    deps.onCounted(data)
    return data
  }
  if (deps.isCurrent()) deps.onDefinition(data)
  if (!data.Id) return data
  let counted: BackgroundResponse
  try {
    counted = await deps.record(data.Id, true)
  } catch {
    return data
  }
  if (!deps.isActive()) {
    if (!counted.success && deps.isCurrent())
      deps.onFailure({ ...counted, fromCache: true })
    return data
  }
  if (counted.status === 404) {
    const fresh = await deps.get(word, true)
    if (!deps.isActive()) return data
    if (!fresh.success || !fresh.ecp) {
      if (deps.isCurrent()) deps.onFailure({ ...fresh, fromCache: true })
      return data
    }
    data = { ...fresh.ecp, LoadCount: undefined, Known: undefined }
    if (deps.isCurrent()) deps.onDefinition(data)
    if (!data.Id) return data
    try {
      counted = await deps.record(data.Id, false)
    } catch {
      return data
    }
  }
  if (!deps.isActive()) {
    if (!counted.success && deps.isCurrent())
      deps.onFailure({ ...counted, fromCache: true })
    return data
  }
  if (counted.success) {
    data = { ...data, LoadCount: counted.queryCount, Known: counted.known }
    if (deps.isCurrent()) deps.onDefinition(data)
    deps.onCounted(data)
  } else if (
    counted.status === 429 ||
    counted.status === 401 ||
    counted.sessionExpired ||
    counted.sessionUnverified
  ) {
    if (deps.isCurrent()) deps.onFailure({ ...counted, fromCache: true })
  }
  return data
}
