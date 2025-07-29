import { useState } from 'react'
import { useAtom } from 'jotai'
import { userAtom, sessionAtom, isLoadingAtom, errorAtom } from '@/store/atoms'
import { apiService } from '@/services/api'

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
      const response = await apiService.login(formData.username, formData.password)
      
      if (response.success && response.data) {
        const userData = response.data.user
        const sessionId = response.data.session_id || response.data.sessionId || ''
        
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

        console.log('Login successful, user and session stored:', { userData, sessionId })
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
      <div className="p-6 bg-white rounded-lg shadow-lg">
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold text-gray-800">Welcome, {user.username}!</h2>
          <p className="text-sm text-gray-600">ENX Extension is ready</p>
        </div>
        
        <div className="space-y-3">
          <button
            onClick={() => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'enxRun' })
              }
            })}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded transition-colors"
            disabled={isLoading}
          >
            Enable Learning Mode
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

      <form onSubmit={showRegister ? handleRegister : handleLogin} className="space-y-4">
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
          {isLoading ? 'Please wait...' : (showRegister ? 'Register' : 'Login')}
        </button>
      </form>

      <div className="mt-4 text-center">
        <button
          onClick={() => {
            setShowRegister(!showRegister)
            setError(null)
            setFormData({ username: '', password: '', email: '', confirmPassword: '' })
          }}
          className="text-blue-500 hover:text-blue-600 text-sm"
          disabled={isLoading}
        >
          {showRegister ? 'Already have an account? Login' : "Don't have an account? Register"}
        </button>
      </div>
    </div>
  )
}