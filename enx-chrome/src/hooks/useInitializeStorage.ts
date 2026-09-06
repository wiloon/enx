import { getApiBaseUrl } from '@/config/env'
import { apiBaseUrlAtom } from '@/store/atoms'
import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

// ADR-015: auth/session state comes from Clerk now, not chrome.storage. This
// hook only resolves the (optionally overridden) API base URL.
export const useInitializeStorage = () => {
  const setApiBaseUrl = useSetAtom(apiBaseUrlAtom)

  useEffect(() => {
    getApiBaseUrl()
      .then(setApiBaseUrl)
      .catch(error =>
        console.error('Error resolving API base URL from storage:', error)
      )
  }, [setApiBaseUrl])
}
