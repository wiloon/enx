// ENX Background Script - Handles API communication and message routing
// Note: Sentry initialization is skipped in service worker context to avoid import issues

import { config } from '@/config/env'

console.log('ENX Background script loaded')

// API configuration
const API_BASE_URL = config.apiBaseUrl
console.log('🌐 Background script API_BASE_URL:', API_BASE_URL)
console.log('🌐 Config environment:', config.environment)
let sessionId = ''

// Load session from storage
const loadSession = async () => {
  try {
    console.log('Loading session from storage...')
    const result = await chrome.storage.local.get(['sessionId'])
    console.log('Storage result:', result)
    if (result.sessionId) {
      sessionId = result.sessionId
      console.log('Session loaded from storage:', sessionId)
    } else {
      console.log('No sessionId found in storage')
    }
  } catch (error) {
    console.error('Error loading session:', error)
  }
}

// Handle session expiry
const handleSessionExpiry = async () => {
  console.log('Session expired, clearing stored data and opening popup')

  // Clear session data
  sessionId = ''
  await chrome.storage.local.remove(['user', 'sessionId'])

  // Try to open the extension popup to show login form
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      // Send message to content script to show a notification about session expiry
      chrome.tabs
        .sendMessage(tab.id, {
          action: 'sessionExpired',
          message:
            'Your session has expired. Please click the extension icon to login again.',
        })
        .catch(() => {
          // Ignore errors if content script is not available
          console.log('Could not notify content script about session expiry')
        })
    }
  } catch (error) {
    console.error('Error handling session expiry:', error)
  }
}

// API request helper
const makeApiRequest = async (endpoint: string, options: RequestInit = {}) => {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    if (sessionId) {
      headers['X-Session-ID'] = sessionId
    }

    console.log(`Making API request to: ${API_BASE_URL}${endpoint}`)
    console.log('Request headers:', headers)
    console.log('Request body:', options.body)
    console.log('Current sessionId:', sessionId)

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })

    console.log(
      `API response status: ${response.status} ${response.statusText}`
    )

    if (!response.ok) {
      if (response.status === 401) {
        // Handle session expiry
        await handleSessionExpiry()
        throw new Error('Session expired')
      }

      // Try to get error details from response body
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      try {
        const errorData = await response.json()
        if (errorData.error || errorData.message) {
          errorMessage = errorData.error || errorData.message
        }
      } catch (e) {
        // Ignore JSON parsing errors, use default message
      }

      throw new Error(errorMessage)
    }

    const data = await response.json()
    console.log('API response data:', data)
    return { success: true, data }
  } catch (error) {
    console.error('API request failed:', error)

    // Check if this is a session expiry error
    if (error instanceof Error && error.message === 'Session expired') {
      return {
        success: false,
        error: 'Your session has expired. Please login again.',
        sessionExpired: true,
      }
    }

    // Network errors
    if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      return {
        success: false,
        error:
          'Unable to connect to translation service. Please check your internet connection.',
      }
    }

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Translation service temporarily unavailable',
    }
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(async details => {
  console.log('ENX Extension installed:', details.reason)

  if (details.reason === 'install') {
    console.log('ENX Extension installed for the first time')
    // Initialize storage
    await chrome.storage.local.set({
      enxEnabled: false,
      wordCache: {},
    })
  } else if (details.reason === 'update') {
    console.log('ENX Extension updated')
  }

  // Load session on installation
  await loadSession()
})

// Handle extension icon clicks
chrome.action.onClicked.addListener(async tab => {
  console.log('ENX Extension icon clicked', tab)

  // Check if user is logged in
  const result = await chrome.storage.local.get(['user'])
  if (!result.user || !result.user.isLoggedIn) {
    console.log('User not logged in, popup will handle this')
    return
  }

  // Toggle ENX functionality on current tab
  if (tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'enxRun' })
    } catch (error) {
      console.error('Error sending message to tab:', error)
    }
  }
})

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('Background received message:', request)

  // Handle async responses
  const handleAsync = async () => {
    try {
      switch (request.type || request.action) {
        case 'getOneWord':
          return await handleGetOneWord(request.word)

        case 'getWords':
          return await handleGetWords(request.paragraph)

        case 'markAcquainted':
          return await handleMarkAcquainted(request.word, request.userId)

        case 'login':
          return await handleLogin(request.username, request.password)

        case 'logout':
          return await handleLogout()

        case 'debugStorage':
          // Debug command to check storage
          const storageData = await chrome.storage.local.get(null)
          console.log('All Chrome storage data:', storageData)
          console.log('Current sessionId in memory:', sessionId)
          return { success: true, storage: storageData, sessionId }

        case 'hello':
          return { success: true, message: 'Hello from ENX background!' }

        default:
          return {
            success: false,
            error: 'Unknown action: ' + (request.type || request.action),
          }
      }
    } catch (error) {
      console.error('Error handling message:', error)
      return { success: false, error: 'Internal error' }
    }
  }

  // Execute async handler and send response
  handleAsync().then(sendResponse)

  return true // Keep the message channel open for async response
})

// Handle get one word translation
const handleGetOneWord = async (word: string) => {
  if (!word || word.trim() === '') {
    return { success: false, error: 'No word provided' }
  }

  console.log('Handling getOneWord request for:', word)
  const encodedWord = encodeURIComponent(word.trim())
  const response = await makeApiRequest(`/api/translate?word=${encodedWord}`)

  console.log('API response for word translation:', response)

  if (response.success) {
    console.log(
      'API response data structure:',
      JSON.stringify(response.data, null, 2)
    )

    // Check multiple possible response formats
    if (response.data) {
      // Try different possible data structures
      const ecp = response.data.ecp || response.data.word || response.data

      if (ecp && (ecp.English || ecp.Chinese || ecp.Pronunciation)) {
        console.log('Found word data:', ecp)
        return {
          success: true,
          ecp: ecp,
        }
      }

      // If we have any data at all, try to use it
      if (response.data.English || response.data.Chinese) {
        console.log('Using direct response data as word data')
        return {
          success: true,
          ecp: response.data,
        }
      }
    }

    console.error(
      'API returned success but unexpected data format:',
      response.data
    )
    return {
      success: false,
      error: 'Unexpected response format from translation service',
    }
  } else {
    console.error('API request failed:', response.error)
    // Pass through session expiry flag
    return {
      success: false,
      error: response.error || 'Translation service error',
      sessionExpired: response.sessionExpired,
    }
  }
}

// Handle get multiple words
const handleGetWords = async (paragraph: string) => {
  if (!paragraph || paragraph.trim() === '') {
    return { success: false, error: 'No paragraph provided' }
  }

  const encodedParagraph = encodeURIComponent(paragraph)
  const response = await makeApiRequest(
    `/api/paragraph-init?paragraph=${encodedParagraph}`
  )

  console.log('paragraph-init API response:', response)

  if (response.success) {
    const wordCount = Object.keys(response.data || {}).length
    console.log('Word properties received:', wordCount, 'words')
    if (wordCount > 0) {
      console.log('Sample words:', Object.keys(response.data).slice(0, 5))
      console.log('Sample word data:', Object.values(response.data)[0])
    }
    return {
      success: true,
      wordProperties: response.data,
    }
  } else {
    // Pass through session expiry flag
    return {
      success: false,
      error: response.error,
      sessionExpired: response.sessionExpired,
    }
  }
}

// Handle mark word as acquainted
const handleMarkAcquainted = async (word: string, userId: number) => {
  if (!word) {
    console.error('handleMarkAcquainted: Missing word', { word })
    return { success: false, error: 'Missing word' }
  }

  console.log('handleMarkAcquainted: Marking word as acquainted', {
    word: word.trim(),
    userId,
  })
  console.log('handleMarkAcquainted: Current sessionId available:', !!sessionId)

  // If no sessionId in memory, try to reload from storage
  if (!sessionId) {
    console.log(
      'handleMarkAcquainted: No sessionId in memory, trying to reload from storage...'
    )
    await loadSession()
    console.log(
      'handleMarkAcquainted: After reload attempt, sessionId available:',
      !!sessionId
    )
  }

  // Check if we have a session
  if (!sessionId) {
    console.error('handleMarkAcquainted: No session ID available')
    // Clear user data since session is invalid
    await chrome.storage.local.remove(['user', 'sessionId'])
    return {
      success: false,
      error: 'Session expired. Please click the extension icon to login again.',
      sessionExpired: true,
    }
  }

  const response = await makeApiRequest('/api/mark', {
    method: 'POST',
    body: JSON.stringify({
      English: word.trim(),
    }),
  })

  console.log('handleMarkAcquainted: API response', response)
  console.log(
    'handleMarkAcquainted: API response data structure:',
    JSON.stringify(response.data, null, 2)
  )

  if (response.success) {
    console.log('handleMarkAcquainted: Word marked successfully')
    console.log(
      'handleMarkAcquainted: Returning ecp data:',
      response.data?.ecp || response.data
    )
    return {
      success: true,
      ecp: response.data?.ecp || response.data,
    }
  } else {
    console.error('handleMarkAcquainted: Failed to mark word', response.error)
    // Pass through session expiry flag
    return {
      success: false,
      error: response.error,
      sessionExpired: response.sessionExpired,
    }
  }
}

// Handle user login
const handleLogin = async (username: string, password: string) => {
  console.log('handleLogin: Starting login process for user:', username)
  const response = await makeApiRequest('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

  console.log('handleLogin: Login API response:', response)

  if (response.success && response.data) {
    console.log('handleLogin: Login successful, response.data:', response.data)

    // API returns session_id, not sessionId
    const sessionIdFromResponse =
      response.data.session_id || response.data.sessionId
    console.log('handleLogin: Extracted session ID:', sessionIdFromResponse)

    sessionId = sessionIdFromResponse

    // Store session in Chrome storage
    const storageData = {
      user: response.data.user,
      sessionId: sessionIdFromResponse,
    }
    console.log('handleLogin: Storing to Chrome storage:', storageData)

    await chrome.storage.local.set(storageData)

    console.log(
      'handleLogin: User logged in successfully, sessionId set to:',
      sessionId
    )
    return {
      success: true,
      data: response.data,
    }
  } else {
    console.error('handleLogin: Login failed:', response)
    return response
  }
}

// Handle user logout
const handleLogout = async () => {
  await makeApiRequest('/api/logout', {
    method: 'POST',
  })

  // Clear session regardless of API response
  sessionId = ''
  await chrome.storage.local.remove(['user', 'sessionId'])

  console.log('User logged out')
  return { success: true }
}

// Handle service worker errors
self.addEventListener('error', event => {
  console.error('ENX Service worker error:', event.error)
})

// Handle unhandled promise rejections
self.addEventListener('unhandledrejection', event => {
  console.error('ENX Unhandled promise rejection:', event.reason)
})

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    console.log('Storage changes detected:', changes)

    // If sessionId changed, update our memory
    if (changes.sessionId) {
      const newSessionId = changes.sessionId.newValue
      if (newSessionId && newSessionId !== sessionId) {
        sessionId = newSessionId
        console.log(
          'Background script updated sessionId from storage:',
          sessionId
        )
      }
    }
  }
})

// Initialize background script
const initialize = async () => {
  await loadSession()
  console.log('ENX Background script initialization complete')
}

initialize()
