'use client'

import { useMe } from './useMe'

// Whether the signed-in user is an enx admin (ADR-021). Sourced from
// GET /api/me's `isAdmin` flag — the ADMIN_CLERK_USER_IDS allowlist itself
// stays in enx-api. This is only a UI signal (admin nav visibility, the
// /admin route gate); every admin endpoint is enforced server-side by
// middleware.RequireAdmin regardless of what the UI shows.
export function useIsAdmin() {
  const { me, isLoading } = useMe()

  return {
    isAdmin: me?.isAdmin ?? false,
    isLoading,
  }
}
