'use client'

import { useEffect } from 'react'
import { useAuthContext } from '@/auth/context'
import { apiService } from '@/services/api'

// Bridges the auth provider's session token into the plain ApiService
// singleton (which is not a hook and can't read the context itself). getToken()
// always returns a fresh, short-lived session token, so ApiService does not
// manage refresh.
export default function ApiAuthBridge() {
  const { getToken } = useAuthContext()

  useEffect(() => {
    apiService.setTokenGetter(() => getToken())
    return () => apiService.setTokenGetter(undefined)
  }, [getToken])

  return null
}
