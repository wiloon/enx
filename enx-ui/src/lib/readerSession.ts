// Hand-off between a document list (My Documents, the Home "Continue reading"
// card) and /reader: the list stashes the document it just fetched, /reader
// picks it up on mount. Reopening therefore reuses the reading-view render
// path instead of re-POSTing the content (ADR-022 Option E1).
//
// The key is part of that contract and is also persisted in the user's
// session storage -- renaming it strands whatever is already stored
// (LAUNCH-CHECKLIST §7.4 "do not rename" table).
export const OPEN_DOC_STORAGE_KEY = 'enx-reader-open-doc'

export type StashedReaderDocument = { id?: string; content?: string }

export function stashReaderDocument(doc: StashedReaderDocument): void {
  try {
    sessionStorage.setItem(OPEN_DOC_STORAGE_KEY, JSON.stringify(doc))
  } catch {
    // Storage unavailable (private browsing, etc.) -- /reader opens empty.
  }
}

// Reads and clears the hand-off in one step: it is meant to be consumed
// exactly once, right after navigating to /reader.
export function consumeReaderDocument(): StashedReaderDocument | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(OPEN_DOC_STORAGE_KEY)
    if (raw) sessionStorage.removeItem(OPEN_DOC_STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    return JSON.parse(raw) as StashedReaderDocument
  } catch {
    // Malformed hand-off payload -- ignore.
    return null
  }
}
