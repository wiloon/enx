'use client'

import { useMe } from './useMe'

// GET /api/me's `isAdmin` flag reflects the server's effective admin
// allowlist (ADR-021). This is only a UI signal (admin nav visibility, the
// /admin route gate); every admin endpoint is enforced server-side by
// middleware.RequireAdmin regardless of what the UI shows.
export function useIsAdmin() {
  const { me, isLoading } = useMe()

  return {
    isAdmin: me?.isAdmin ?? false,
    isLoading,
  }
}
