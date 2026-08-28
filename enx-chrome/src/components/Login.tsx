import { errorAtom, isLoadingAtom, sessionAtom, userAtom } from '@/store/atoms'
import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'
import { sendMessageToBackground } from '@/services/api'
import type { ApiRequestResult } from '@/background/background'

interface LoginProps {
  onLoginSuccess?: () => void
}

type CognitoSignInResponse = {
  success: boolean
  error?: string
  user?: {
    id: number
    username: string
    email: string
    status?: string
    isLoggedIn: true
  }
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
      sendMessageToBackground<ApiRequestResult>({ type: 'validateSession' })
        .then(resp => {
          if (resp.success && resp.data) {
            setUser({
              id: resp.data.id as unknown as number,
              username: resp.data.name,
              email: resp.data.email,
              status: resp.data.status,
              isLoggedIn: true,
            })
          }
        })
        .catch(() => {})
    }
  }, [])

  const handleCognitoSignIn = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = (await chrome.runtime.sendMessage({
        action: 'cognitoSignIn',
      })) as CognitoSignInResponse

      if (!response?.success || !response.user) {
        throw new Error(response?.error || 'Sign-in failed')
      }

      const result = await chrome.storage.local.get([
        'accessToken',
        'refreshToken',
        'enx-session',
      ])
      const access =
        (result.accessToken as string) ||
        result['enx-session']?.accessToken ||
        ''
      const refresh =
        (result.refreshToken as string) ||
        result['enx-session']?.refreshToken ||
        ''

      setUser(response.user)
      setSession({ accessToken: access, refreshToken: refresh })

      onLoginSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    setError(null)
    // Local token removal is the source of truth -- clear the UI immediately.
    // The Hosted UI logout (launchWebAuthFlow) is best-effort and can hang
    // (e.g. the proxy not covering the auth window), so don't block the popup
    // on it. Also don't route logout through isLoadingAtom: it's shared with
    // sign-in, and its logged-out-view label is "Signing in…", which is what
    // showed on the Sign out button while the hung logout kept isLoading true.
    setUser({ id: 0, username: '', email: '', isLoggedIn: false })
    setSession({ accessToken: '', refreshToken: '' })
    chrome.runtime
      .sendMessage({ action: 'cognitoSignOut' })
      .catch(e => console.error('Sign-out message failed:', e))
  }

  const handleEnableLearning = async () => {
    setUnderliningStatus('processing')
    setError(null)
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id) {
        throw new Error('No active tab found')
      }
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'enxRun',
      })
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to enable learning mode')
      }
      setUnderliningStatus('completed')
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      setError(
        message.includes('Receiving end does not exist')
          ? 'This page needs to be refreshed before learning mode can start. Reload the page and try again.'
          : message || 'Could not enable learning on this page'
      )
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
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
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
