import type { ApiResponse } from '@/types'

// The data of a successful response, for a React Query queryFn or
// mutationFn. A failure, or a success without data, throws the server's error
// or, when it carries none, the caller's fallback message.
export function unwrap<T>(resp: ApiResponse<T>, fallback: string): T {
  if (resp.success && resp.data) return resp.data
  throw new Error(resp.error || fallback)
}
