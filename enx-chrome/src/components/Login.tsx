import { apiService } from '@/services/api'
import { errorAtom, isLoadingAtom, sessionAtom, userAtom } from '@/store/atoms'
import { useAtom } from 'jotai'
import { useState } from 'react'

interface LoginProps {
  onLoginSuccess?: () => void
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [user, setUser] = useAtom(userAtom)
  const [, setSession] = useAtom(sessionAtom)
  const [isLoading, setIsLoading] = useAtom(isLoadingAtom)
  const [error, setError] = useAtom(errorAtom)

  const [showRegister, setShowRegister] = useState(false)
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    confirmPassword: '',
  })
  const [underliningStatus, setUnderliningStatus] = useState<
    'idle' | 'processing' | 'completed'
  >('idle')

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.username || !formData.password) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await apiService.login(
        formData.username,
        formData.password
      )

      if (response.success && response.data) {
        const userData = response.data.user
        const sessionId =
          response.data.session_id || response.data.sessionId || ''

        setUser({
          ...userData,
          isLoggedIn: true,
        })

        setSession({
          sessionId,
          token: sessionId, // Using sessionId as token for compatibility
        })

        // Store in Chrome storage for background script access
        await chrome.storage.local.set({
          user: userData,
          sessionId,
        })

        console.log('Login successful, user and session stored:', {
          userData,
          sessionId,
        })
        onLoginSuccess?.()
      } else {
        setError(response.error || 'Login failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.username || !formData.password || !formData.email) return

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await apiService.register(
        formData.username,
        formData.email,
        formData.password
      )

      if (response.success) {
        setError(null)
        setShowRegister(false)
        // Auto-login after registration
        await handleLogin(e)
      } else {
        setError(response.error || 'Registration failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEnableLearningMode = async () => {
    if (underliningStatus === 'processing') return

    setUnderliningStatus('processing')
    setError(null) // Clear previous errors

    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tabs[0]?.id) {
        console.error('No active tab found')
        setError('Failed to find active tab')
        setUnderliningStatus('idle')
        return
      }

      const tab = tabs[0]
      const tabId = tab.id as number
      console.log('Current tab:', tab.url)

      // Check if URL is supported
      if (
        !tab.url ||
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://')
      ) {
        setError(
          'This page is not supported. Supported sites: bbc.com, infoq.com, novel.tingroom.com, wiloon.com'
        )
        setUnderliningStatus('idle')
        return
      }

      try {
        // Try to send message to existing content script
        const response = (await chrome.tabs.sendMessage(tabId, {
          action: 'enxRun',
        })) as { success: boolean; completed?: boolean }
        console.log('Content script response:', response)

        if (response?.success) {
          if (response.completed) {
            console.log('✅ Article processing completed successfully')
            setError(null)
            setUnderliningStatus('completed')
            setTimeout(() => setUnderliningStatus('idle'), 3000)
          } else {
            console.warn(
              '⚠️ Content script returned success but completed=false'
            )
            setError(
              'Article processing incomplete. Possible reasons: No article content found, empty word cache, or processing error. Check console for details.'
            )
            setUnderliningStatus('idle')
          }
        } else {
          console.error('Content script returned error:', response)
          setError('Failed to enable learning mode. Check console for details.')
          setUnderliningStatus('idle')
        }
      } catch (error) {
        // Content script might not be injected yet, try to inject it
        console.log('Content script not found, trying to inject...', error)

        try {
          // Inject content script programmatically
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/content/content.ts'],
          })

          console.log('Content script injected, waiting 1 second...')

          // Wait a bit for the script to initialize
          await new Promise(resolve => setTimeout(resolve, 1000))

          // Try sending message again
          const retryResponse = (await chrome.tabs.sendMessage(tabId, {
            action: 'enxRun',
          })) as { success: boolean; completed?: boolean }
          console.log('Retry response:', retryResponse)

          if (retryResponse?.success) {
            if (retryResponse.completed) {
              console.log(
                '✅ Article processing completed successfully (retry)'
              )
              setError(null)
              setUnderliningStatus('completed')
              setTimeout(() => setUnderliningStatus('idle'), 3000)
            } else {
              console.warn(
                '⚠️ Retry: Content script returned success but completed=false'
              )
              setError(
                'Article processing incomplete. Please refresh the page and try again.'
              )
              setUnderliningStatus('idle')
            }
          } else {
            setError(
              'Failed to enable learning mode. Please refresh the page and try again.'
            )
            setUnderliningStatus('idle')
          }
        } catch (injectError) {
          console.error('Failed to inject content script:', injectError)
          setError(
            'Cannot enable learning mode on this page. It may not be in the supported list or has permission restrictions.'
          )
          setUnderliningStatus('idle')
        }
      }
    } catch (error) {
      console.error('Error enabling learning mode:', error)
      setError(
        `Activation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
      setUnderliningStatus('idle')
    }
  }

  const handleLogout = async () => {
    setIsLoading(true)

    try {
      await apiService.logout()

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
      await chrome.storage.local.remove(['user', 'sessionId'])
    } catch (err) {
      console.error('Logout error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // If user is logged in, show user info
  if (user.isLoggedIn) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-lg min-w-[300px]">
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">
            Welcome, {user.username}!
          </h2>
          <p className="text-sm text-gray-600">ENX Extension is ready</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleEnableLearningMode}
            className={`w-full font-medium py-2 px-4 rounded transition-colors flex items-center justify-center ${
              underliningStatus === 'completed'
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
            disabled={isLoading || underliningStatus === 'processing'}
          >
            {underliningStatus === 'processing' && (
              <svg
                className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
            )}
            {underliningStatus === 'completed' && (
              <svg
                className="-ml-1 mr-2 h-4 w-4 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
            {underliningStatus === 'idle' && 'Enable Learning Mode'}
            {underliningStatus === 'processing' && 'Processing Article...'}
            {underliningStatus === 'completed' && 'Article Ready!'}
          </button>

          <button
            onClick={handleLogout}
            className="w-full bg-gray-500 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded transition-colors"
            disabled={isLoading}
          >
            {isLoading ? 'Logging out...' : 'Logout'}
          </button>
        </div>
      </div>
    )
  }

  // Login/Register form
  return (
    <div className="p-6 bg-white rounded-lg shadow-lg min-w-[300px]">
      <h2 className="text-xl font-bold text-gray-800 mb-4">
        {showRegister ? 'Register' : 'ENX Login'}
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      <form
        onSubmit={showRegister ? handleRegister : handleLogin}
        className="space-y-4"
      >
        <div>
          <input
            type="text"
            name="username"
            placeholder="Username"
            value={formData.username}
            onChange={handleInputChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
            disabled={isLoading}
          />
        </div>

        {showRegister && (
          <div>
            <input
              type="email"
              name="email"
              placeholder="Email"
              value={formData.email}
              onChange={handleInputChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
              disabled={isLoading}
            />
          </div>
        )}

        <div>
          <input
            type="password"
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleInputChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
            disabled={isLoading}
          />
        </div>

        {showRegister && (
          <div>
            <input
              type="password"
              name="confirmPassword"
              placeholder="Confirm Password"
              value={formData.confirmPassword}
              onChange={handleInputChange}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
              disabled={isLoading}
            />
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded transition-colors disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? 'Please wait...' : showRegister ? 'Register' : 'Login'}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          onClick={() => {
            setShowRegister(!showRegister)
            setError(null)
            setFormData({
              username: '',
              password: '',
              email: '',
              confirmPassword: '',
            })
          }}
          className="text-blue-500 hover:text-blue-600 text-sm"
          disabled={isLoading}
        >
          {showRegister
            ? 'Already have an account? Login'
            : "Don't have an account? Register"}
        </button>
      </div>
    </div>
  )
}
