// Turns the reply to a 'savePage' message (the background's ApiRequestResult)
// into what the popup shows (ADR-032).

import type { PageSaveStatus } from '@/components/PageSavePrompt'
import type { ApiRequestResult } from '@/background/background'

export interface SaveOutcome {
  status: PageSaveStatus
  /** The address enx-api actually stored (normalized). */
  savedUrl?: string
  errorMessage?: string
}

export function saveOutcome(result: ApiRequestResult): SaveOutcome {
  if (!result.success) {
    return { status: 'failed', errorMessage: result.error }
  }
  const savedUrl = result.data?.page?.url
  return { status: result.data?.created === false ? 'already-saved' : 'saved', savedUrl }
}
