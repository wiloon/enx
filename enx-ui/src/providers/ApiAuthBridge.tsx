'use client'

import { useEffect } from 'react'
import { useAuth } from '@clerk/nextjs'
import { apiService } from '@/services/api'

// Bridges Clerk's session token into the plain ApiService singleton (which is
// not a hook and can't call useAuth itself). Clerk's getToken() always returns
// a fresh, short-lived session JWT, so ApiService no longer manages refresh.
export default function ApiAuthBridge() {
  const { getToken } = useAuth()

  useEffect(() => {
    apiService.setTokenGetter(() => getToken())
    return () => apiService.setTokenGetter(undefined)
  }, [getToken])

  return null
}
