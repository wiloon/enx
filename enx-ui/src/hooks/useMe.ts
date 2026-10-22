'use client'

import { useQuery } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { useAuth } from './useAuth'

// The signed-in account as enx-api knows it (GET /api/me): the enx user ID,
// profile, avatar, join date and admin flag. One cached query shared by the
// account menu, /account and useIsAdmin.
export function useMe() {
  const { isAuthenticated } = useAuth()

  const { data, isLoading, error } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const resp = await apiService.getMe()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load account')
    },
    enabled: isAuthenticated,
  })

  return {
    me: data,
    // Only "loading" while we actually expect an answer.
    isLoading: isAuthenticated && isLoading,
    error,
  }
}
