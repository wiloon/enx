import { SignOutButton, useUser } from '@clerk/chrome-extension'
import { config } from '@/config/env'
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
    // OAuth (Google/GitHub) can't complete inside the extension popup -- the
    // popup is destroyed the moment it loses focus. Sign in on the Catseye
    // website instead (full-page Clerk UI, OAuth works there); the extension
    // then picks up the session automatically via ClerkProvider `syncHost`.
    const openWebSignIn = () => {
      chrome.tabs.create({ url: `${config.clerkSyncHost}/sign-in` })
    }
    return (
      <div className="w-80 p-4 space-y-3">
        <h2 className="text-lg font-semibold">Catseye</h2>
        <p className="text-sm text-gray-600">
          Sign in to start highlighting and looking up words as you read.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          onClick={openWebSignIn}
        >
          Sign in on the web
        </button>
        <p className="text-xs text-gray-400">
          Opens Catseye in a new tab. Once you&apos;re signed in there, come back
          — this popup updates on its own.
        </p>
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
