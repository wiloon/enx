import { SignIn, SignOutButton, useUser } from '@clerk/chrome-extension'
import { errorAtom } from '@/store/atoms'
import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'

interface LoginProps {
  onLoginSuccess?: () => void
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const { isLoaded, isSignedIn, user } = useUser()
  const [error, setError] = useAtom(errorAtom)
  const [underliningStatus, setUnderliningStatus] = useState<
    'idle' | 'processing' | 'completed'
  >('idle')

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      onLoginSuccess?.()
    }
  }, [isLoaded, isSignedIn, onLoginSuccess])

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

  if (!isLoaded) {
    return <div className="w-80 p-4 text-sm text-gray-600">Loading…</div>
  }

  if (!isSignedIn) {
    return (
      <div className="w-80 p-4">
        <h2 className="text-lg font-semibold mb-2">ENX Sign in</h2>
        <p className="text-sm text-gray-600 mb-3">
          Sign in with Google, GitHub, or email. If you&apos;re already signed
          in on the Catseye website, this opens signed in.
        </p>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <SignIn routing="hash" />
      </div>
    )
  }

  const displayName =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    'there'

  return (
    <div className="w-80 p-4">
      <p className="mb-2">Welcome, {displayName}!</p>
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
      <SignOutButton>
        <button type="button" className="w-full border py-2 rounded">
          Sign out
        </button>
      </SignOutButton>
    </div>
  )
}
