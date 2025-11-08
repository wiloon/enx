import DebugPanel from '@/components/DebugPanel'
import Login from '@/components/Login'
import { useInitializeStorage } from '@/hooks/useInitializeStorage'
import '@/index.css'
import { initSentry } from '@/lib/sentry'
import { apiService } from '@/services/api'
import { apiBaseUrlAtom, sessionAtom, userAtom } from '@/store/atoms'
import { Provider, useAtom } from 'jotai'
import { useEffect } from 'react'

initSentry()

function PopupContent() {
  const [apiBaseUrl] = useAtom(apiBaseUrlAtom)
  const [user, setUser] = useAtom(userAtom)
  const [session, setSession] = useAtom(sessionAtom)

  // Initialize state from Chrome storage (this will also load API URL)
  useInitializeStorage()

  // Update API service when base URL changes
  useEffect(() => {
    console.log('Setting API base URL to:', apiBaseUrl)
    apiService.setBaseUrl(apiBaseUrl)
  }, [apiBaseUrl])

  // Validate session on popup open
  useEffect(() => {
    const validateSession = async () => {
      if (user.isLoggedIn && session.sessionId) {
        try {
          apiService.setSessionId(session.sessionId)
          const response = await apiService.validateSession()

          if (!response.success) {
            console.log('Session validation failed, logging out user')

            // Clear user and session state
            setUser({
              id: 0,
              username: '',
              email: '',
              isLoggedIn: false,
            })

            setSession({
              sessionId: '',
              token: '',
            })

            // Clear Chrome storage
            await chrome.storage.local.remove([
              'user',
              'sessionId',
              'enx-user',
              'enx-session',
            ])

            apiService.setSessionId('')
          }
        } catch (error) {
          console.error('Session validation error:', error)
        }
      }
    }

    validateSession()
  }, [user.isLoggedIn, session.sessionId, setUser, setSession])

  const handleLoginSuccess = () => {
    console.log('Login successful, ready to use ENX')
  }

  return (
    <div className="min-w-[350px] min-h-[200px] bg-gray-50">
      {/* Header */}
      <div className="bg-blue-500 text-white p-3 text-center">
        <h1 className="text-lg font-bold">ENX Extension</h1>
        <p className="text-sm opacity-90">English Learning Assistant</p>
      </div>

      {/* Main content */}
      <div className="p-0">
        <Login onLoginSuccess={handleLoginSuccess} />
      </div>

      {/* Footer */}
      <div className="p-3 text-center text-xs text-gray-500 border-t border-gray-200">
        <p>Click on any English word to see translation</p>
        <div className="flex justify-between items-center mt-2">
          <span className="text-gray-400">v{__APP_VERSION__}</span>
          <DebugPanel />
        </div>
      </div>
    </div>
  )
}

export default function Popup() {
  return (
    <Provider>
      <PopupContent />
    </Provider>
  )
}
