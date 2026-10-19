'use client'

import { useSyncExternalStore } from 'react'
import { apiService } from '@/services/api'

// Whether enx-api has said this account is disabled (ADR-062 Decision 5).
// It stays true for the rest of the page's life: the admin re-enabling the
// account takes a fresh sign-in.
export function useAccountDisabled(): boolean {
  return useSyncExternalStore(
    (onChange) => apiService.onAccountDisabled(onChange),
    () => apiService.isAccountDisabled(),
    () => false
  )
}
