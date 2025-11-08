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
        console.log('Initializing from Chrome storage...')

        // Initialize API base URL first
        const apiUrl = await getApiBaseUrl()
        console.log('Loaded API URL:', apiUrl)
        setApiBaseUrl(apiUrl)
        apiService.setBaseUrl(apiUrl)

        // Load user and session data from Chrome storage
        const result = await chrome.storage.local.get([
          'enx-user',
          'enx-session',
          'user', // Fallback for background script compatibility
          'sessionId', // Fallback for background script compatibility
        ])

        console.log('Storage result:', result)

        // Initialize user state
        let userData = result['enx-user']
        if (!userData && result.user) {
          // Fallback to old format
          userData = result.user
        }

        if (userData && userData.isLoggedIn) {
          console.log('Restoring user from storage:', userData)
          setUser(userData)
        } else {
          // No valid user data, reset to logged out state
          setUser({
            id: 0,
            username: '',
            email: '',
            isLoggedIn: false,
          })
        }

        // Initialize session state
        let sessionData = result['enx-session']
        if (!sessionData && result.sessionId) {
          // Fallback to old format
          sessionData = {
            sessionId: result.sessionId,
            token: result.sessionId,
          }
        }

        if (sessionData && sessionData.sessionId) {
          console.log('Restoring session from storage:', sessionData)
          setSession(sessionData)

          // Initialize API service with session
          apiService.setSessionId(sessionData.sessionId)
        } else {
          // No valid session data, reset session state
          setSession({
            sessionId: '',
            token: '',
          })
          apiService.setSessionId('')
        }
      } catch (error) {
        console.error('Error initializing from storage:', error)
      }
    }

    // Listen for storage changes to handle session expiry
    const handleStorageChange = (changes: {
      [key: string]: chrome.storage.StorageChange
    }) => {
      console.log('Storage changes detected:', changes)

      // Handle user data changes
      if (changes.user || changes['enx-user']) {
        const userChange = changes.user || changes['enx-user']
        if (userChange.newValue && userChange.newValue.isLoggedIn) {
          console.log('User logged in via storage change:', userChange.newValue)
          setUser(userChange.newValue)
        } else if (!userChange.newValue) {
          console.log('User logged out via storage change')
          setUser({
            id: 0,
            username: '',
            email: '',
            isLoggedIn: false,
          })
        }
      }

      // Handle session data changes
      if (changes.sessionId || changes['enx-session']) {
        const sessionChange = changes.sessionId || changes['enx-session']
        if (sessionChange.newValue) {
          const sessionData =
            typeof sessionChange.newValue === 'string'
              ? {
                  sessionId: sessionChange.newValue,
                  token: sessionChange.newValue,
                }
              : sessionChange.newValue

          console.log('Session updated via storage change:', sessionData)
          setSession(sessionData)
          apiService.setSessionId(sessionData.sessionId)
        } else if (!sessionChange.newValue) {
          console.log('Session cleared via storage change')
          setSession({
            sessionId: '',
            token: '',
          })
          apiService.setSessionId('')
        }
      }
    }

    initializeFromStorage()

    // Listen for storage changes
    chrome.storage.local.onChanged.addListener(handleStorageChange)

    // Cleanup listener on unmount
    return () => {
      chrome.storage.local.onChanged.removeListener(handleStorageChange)
    }
  }, [setUser, setSession])
}
