import type { BackgroundResponse, WordData } from '@/types'

export interface DictionaryLookupDeps {
  // The definition, from the local cache or a QUERY; `refresh` drops the
  // cached entry first.
  get: (word: string, refresh?: boolean) => Promise<BackgroundResponse>
  // POST /api/me/word-lookups: the one request that counts a lookup.
  record: (wordId: string) => Promise<BackgroundResponse>
  isActive: () => boolean
  isCurrent: () => boolean
  onDefinition: (word: WordData) => void
  onCounted: (word: WordData) => void
  // No definition to show: shown in its place.
  onFailure: (response: BackgroundResponse) => void
  // The definition is shown but recording it was refused: shown under it.
  onRecordFailure: (response: BackgroundResponse) => void
}

// One shared decision flow for page clicks, panel clicks and read-only cards
// (ADR-079 Decision 2). A click is a lookup: it shows the definition at once,
// cached or read, then sends one POST, whose answer brings the query count and
// "known". A read-only card never records. Account changes discard all
// effects; a replaced popover only discards rendering.
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
  if (!options.counts) {
    const data = {
      ...response.ecp,
      LoadCount: options.state?.LoadCount,
      Known: options.state?.Known,
    }
    if (deps.isCurrent()) deps.onDefinition(data)
    return data
  }
  let data: WordData = {
    ...response.ecp,
    LoadCount: undefined,
    Known: undefined,
  }
  if (deps.isCurrent()) deps.onDefinition(data)
  if (!data.Id) return data
  let counted: BackgroundResponse
  try {
    counted = await deps.record(data.Id)
  } catch {
    return data
  }
  if (deps.isActive() && counted.status === 404) {
    const fresh = await deps.get(word, true)
    if (!deps.isActive()) return data
    if (!fresh.success || !fresh.ecp) {
      if (deps.isCurrent()) deps.onRecordFailure(fresh)
      return data
    }
    data = { ...fresh.ecp, LoadCount: undefined, Known: undefined }
    if (deps.isCurrent()) deps.onDefinition(data)
    if (!data.Id) return data
    try {
      counted = await deps.record(data.Id)
    } catch {
      return data
    }
  }
  if (!deps.isActive()) {
    if (!counted.success && deps.isCurrent()) deps.onRecordFailure(counted)
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
    if (deps.isCurrent()) deps.onRecordFailure(counted)
  }
  return data
}
