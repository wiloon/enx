import type { ApiResponse, WordLookupRecord } from '@/types'

// A submit records once, by the resolved definition's id. Definitions have
// no count or known state: only a successful POST can supply those fields.
// A recording 429 carries the server's message and, to tell a quota refusal
// from a rate limit, its code and upgrade flag.
export async function recordLookup(
  wordId: string,
  send: (id: string) => Promise<ApiResponse<WordLookupRecord>>
): Promise<{
  LoadCount?: number
  Known?: boolean
  message?: string
  code?: string
  upgrade?: true
}> {
  if (!wordId) return {}
  try {
    const response = await send(wordId)
    if (response.success && response.data) {
      return { LoadCount: response.data.queryCount, Known: response.data.known }
    }
    if (response.status === 429)
      return {
        message: response.error,
        code: response.code,
        upgrade: response.upgrade,
      }
  } catch {
    // Recording is not idempotent. Keep the definition and never retry.
  }
  return {}
}
