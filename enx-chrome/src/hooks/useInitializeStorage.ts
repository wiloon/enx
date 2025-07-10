import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { userAtom, sessionAtom } from '@/store/atoms'
import { apiService } from '@/services/api'

export const useInitializeStorage = () => {
  const setUser = useSetAtom(userAtom)
  const setSession = useSetAtom(sessionAtom)

  useEffect(() => {
    const initializeFromStorage = async () => {
      try {
        console.log('Initializing from Chrome storage...')
        
        // Load user and session data from Chrome storage
        const result = await chrome.storage.local.get([
          'enx-user', 
          'enx-session',
          'user',        // Fallback for background script compatibility
          'sessionId'    // Fallback for background script compatibility
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
        }

        // Initialize session state
        let sessionData = result['enx-session']
        if (!sessionData && result.sessionId) {
          // Fallback to old format
          sessionData = {
            sessionId: result.sessionId,
            token: result.sessionId
          }
        }
        
        if (sessionData && sessionData.sessionId) {
          console.log('Restoring session from storage:', sessionData)
          setSession(sessionData)
          
          // Initialize API service with session
          apiService.setSessionId(sessionData.sessionId)
        }
        
      } catch (error) {
        console.error('Error initializing from storage:', error)
      }
    }

    initializeFromStorage()
  }, [setUser, setSession])
}