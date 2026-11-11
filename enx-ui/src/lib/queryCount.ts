import type { ApiResponse } from '@/types'

// A submit records once, by the resolved definition's id. Definitions have
// no count or known state: only a successful POST can supply those fields.
export async function recordLookup(
  wordId: string,
  send: (
    id: string
  ) => Promise<ApiResponse<{ queryCount: number; known: boolean }>>
): Promise<{ LoadCount?: number; Known?: boolean; message?: string }> {
  if (!wordId) return {}
  try {
    const response = await send(wordId)
    if (response.success && response.data) {
      return { LoadCount: response.data.queryCount, Known: response.data.known }
    }
    if (response.status === 429) return { message: response.error }
  } catch {
    // Recording is not idempotent. Keep the definition and never retry.
  }
  return {}
}
