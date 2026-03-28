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

  useInitializeStorage()

  useEffect(() => {
    apiService.setBaseUrl(apiBaseUrl)
  }, [apiBaseUrl])

  useEffect(() => {
    const validate = async () => {
      if (!user.isLoggedIn || !session.accessToken) return
      apiService.setAccessToken(session.accessToken)
      const response = await apiService.validateSession()
      if (!response.success) {
        setUser({ id: 0, username: '', email: '', isLoggedIn: false })
        setSession({ accessToken: '', refreshToken: '' })
        apiService.setAccessToken('')
        await chrome.storage.local.remove([
          'user',
          'enx-user',
          'accessToken',
          'refreshToken',
          'enx-session',
        ])
      }
    }
    validate()
  }, [user.isLoggedIn, session.accessToken, setUser, setSession])

  const handleLoginSuccess = () => {
    console.log('Login successful')
  }

  return (
    <div className="min-h-[200px]">
      <Login onLoginSuccess={handleLoginSuccess} />
      {process.env.NODE_ENV === 'development' && <DebugPanel />}
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
