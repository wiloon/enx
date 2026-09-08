'use client'

import { useQuery } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { useAuth } from './useAuth'

// Whether the signed-in user is an enx admin (ADR-021). Sourced from
// GET /api/me's `isAdmin` flag — the ADMIN_CLERK_USER_IDS allowlist itself
// stays in enx-api. This is only a UI signal (admin nav visibility, the
// /admin route gate); every admin endpoint is enforced server-side by
// middleware.RequireAdmin regardless of what the UI shows.
export function useIsAdmin() {
  const { isAuthenticated } = useAuth()

  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const resp = await apiService.getMe()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load account')
    },
    enabled: isAuthenticated,
  })

  return {
    isAdmin: data?.isAdmin ?? false,
    // Only "loading" while we actually expect an answer.
    isLoading: isAuthenticated && isLoading,
  }
}
