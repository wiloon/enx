// Turns the reply to a 'savePage' message (the background's ApiRequestResult)
// into what the popup keeps (ADR-032).

import type { ApiRequestResult } from '@/background/background'
import type { SavedPageRef } from '@/lib/savedPagesStore'

export type SaveOutcome =
  { ok: true; page: SavedPageRef } | { ok: false; errorMessage?: string }

// Saving a page that is already saved is a success too: enx-api answers 200
// with the existing page, and either way the page is now on the list.
export function saveOutcome(result: ApiRequestResult): SaveOutcome {
  const page = result.data?.page
  if (!result.success || !page?.id || !page?.url) {
    return { ok: false, errorMessage: result.error }
  }
  return { ok: true, page: { id: String(page.id), url: String(page.url) } }
}
