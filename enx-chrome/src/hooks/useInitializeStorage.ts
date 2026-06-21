import { getApiBaseUrl } from '@/config/env'
import { apiService } from '@/services/api'
import { apiBaseUrlAtom, sessionAtom, userAtom } from '@/store/atoms'
import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

export const useInitializeStorage = () => {
  const setUser = useSetAtom(userAtom)
  const setSession = useSetAtom(sessionAtom)
  const setApiBaseUrl = useSetAtom(apiBaseUrlAtom)

  useEffect(() => {
    const initializeFromStorage = async () => {
      try {
        const apiUrl = await getApiBaseUrl()
        setApiBaseUrl(apiUrl)
        apiService.setBaseUrl(apiUrl)

        const result = await chrome.storage.local.get([
          'enx-user',
          'enx-session',
          'user',
          'accessToken',
        ])

        const userData = result['enx-user'] || result.user
        if (userData?.isLoggedIn) {
          setUser(userData)
        } else {
          setUser({ id: 0, username: '', email: '', isLoggedIn: false })
        }

        const token =
          result.accessToken ||
          result['enx-session']?.accessToken ||
          ''
        const refresh =
          result['enx-session']?.refreshToken ||
          result.refreshToken ||
          ''

        if (token) {
          setSession({ accessToken: token, refreshToken: refresh })
          apiService.setAccessToken(token)
        } else {
          setSession({ accessToken: '', refreshToken: '' })
          apiService.setAccessToken('')
        }
      } catch (error) {
        console.error('Error initializing from storage:', error)
      }
    }

    const handleStorageChange = (changes: {
      [key: string]: chrome.storage.StorageChange
    }) => {
      if (changes.user || changes['enx-user']) {
        const userChange = changes.user || changes['enx-user']
        if (userChange.newValue?.isLoggedIn) {
          setUser(userChange.newValue)
        } else if (!userChange.newValue) {
          setUser({ id: 0, username: '', email: '', isLoggedIn: false })
        }
      }
      if (changes.accessToken) {
        const token = changes.accessToken.newValue as string
        if (token) {
          setSession({ accessToken: token, refreshToken: '' })
          apiService.setAccessToken(token)
        } else {
          setSession({ accessToken: '', refreshToken: '' })
          apiService.setAccessToken('')
        }
      }
    }

    initializeFromStorage()
    chrome.storage.local.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.local.onChanged.removeListener(handleStorageChange)
  }, [setUser, setSession, setApiBaseUrl])
}
