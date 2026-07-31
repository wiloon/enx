import DebugPanel from '@/components/DebugPanel'
import Login from '@/components/Login'
import { useInitializeStorage } from '@/hooks/useInitializeStorage'
import '@/index.css'
import { initSentry } from '@/lib/sentry'
import { sendMessageToBackground } from '@/services/api'
import { sessionAtom, userAtom } from '@/store/atoms'
import { Provider, useAtom } from 'jotai'
import { useEffect } from 'react'
import type { ApiRequestResult } from '@/background/background'

initSentry()

function PopupContent() {
  const [user, setUser] = useAtom(userAtom)
  const [session, setSession] = useAtom(sessionAtom)

  useInitializeStorage()

  useEffect(() => {
    const validate = async () => {
      if (!user.isLoggedIn || !session.accessToken) return
      // Goes through background's makeApiRequest, which silently refreshes an
      // expired access token and retries once before reporting failure — see
      // docs/tasks/TASK-SPEC-enx-cognito-session-refresh.md §3.5.
      const response = await sendMessageToBackground<ApiRequestResult>({
        type: 'validateSession',
      })
      if (!response.success) {
        setUser({ id: 0, username: '', email: '', isLoggedIn: false })
        setSession({ accessToken: '', refreshToken: '' })
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
