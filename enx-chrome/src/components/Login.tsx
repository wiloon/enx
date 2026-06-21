import { apiService } from '@/services/api'
import { signInWithCognito } from '@/lib/cognito'
import { errorAtom, isLoadingAtom, sessionAtom, userAtom } from '@/store/atoms'
import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'

interface LoginProps {
  onLoginSuccess?: () => void
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [user, setUser] = useAtom(userAtom)
  const [, setSession] = useAtom(sessionAtom)
  const [isLoading, setIsLoading] = useAtom(isLoadingAtom)
  const [error, setError] = useAtom(errorAtom)
  const [underliningStatus, setUnderliningStatus] = useState<
    'idle' | 'processing' | 'completed'
  >('idle')

  useEffect(() => {
    if (user.isLoggedIn) {
      apiService.getMe().then((resp) => {
        if (resp.success && resp.data) {
          setUser({
            id: resp.data.id as unknown as number,
            username: resp.data.name,
            email: resp.data.email,
            status: resp.data.status,
            isLoggedIn: true,
          })
        }
      }).catch(() => {})
    }
  }, [])

  const handleCognitoSignIn = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const tokens = await signInWithCognito()
      apiService.setAccessToken(tokens.access_token)

      const me = await apiService.getMe()
      const userData = me.success && me.data
        ? {
            id: me.data.id as unknown as number,
            username: me.data.name,
            email: me.data.email,
            status: me.data.status,
            isLoggedIn: true,
          }
        : {
            id: 0,
            username: 'user',
            email: '',
            isLoggedIn: true,
          }

      setUser(userData)
      setSession({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
      })

      await chrome.storage.local.set({
        user: userData,
        'enx-user': userData,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || '',
      })

      onLoginSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
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

  const handleEnableLearning = async () => {
    setUnderliningStatus('processing')
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'enxRun' })
        setUnderliningStatus('completed')
      }
    } catch {
      setError('Could not enable learning on this page')
      setUnderliningStatus('idle')
    }
  }

  if (!user.isLoggedIn) {
    return (
      <div className="w-80 p-4">
        <h2 className="text-lg font-semibold mb-2">ENX Sign in</h2>
        <p className="text-sm text-gray-600 mb-4">
          Sign in with email or Google (AWS Cognito).
        </p>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <button
          type="button"
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          disabled={isLoading}
          onClick={handleCognitoSignIn}
        >
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    )
  }

  return (
    <div className="w-80 p-4">
      <p className="mb-2">Welcome, {user.username}!</p>
      <button
        type="button"
        className="w-full bg-green-600 text-white py-2 rounded mb-2 hover:bg-green-700"
        onClick={handleEnableLearning}
        disabled={underliningStatus === 'processing'}
      >
        {underliningStatus === 'processing'
          ? 'Enabling…'
          : underliningStatus === 'completed'
            ? 'Enabled'
            : 'Enable Learning Mode'}
      </button>
      <button
        type="button"
        className="w-full border py-2 rounded"
        onClick={handleLogout}
      >
        Sign out
      </button>
    </div>
  )
}
