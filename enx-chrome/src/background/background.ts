// ENX Background Script - Handles API communication and message routing
// Note: Sentry initialization is skipped in service worker context to avoid import issues

console.log('ENX Background script loaded')

// API configuration
const API_BASE_URL = 'https://enx-dev.wiloon.com'
let sessionId = ''

// Load session from storage
const loadSession = async () => {
  try {
    const result = await chrome.storage.local.get(['sessionId'])
    if (result.sessionId) {
      sessionId = result.sessionId
      console.log('Session loaded from storage')
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
      chrome.tabs.sendMessage(tab.id, { 
        action: 'sessionExpired',
        message: 'Your session has expired. Please click the extension icon to login again.'
      }).catch(() => {
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
      ...(options.headers as Record<string, string> || {}),
    }

    if (sessionId) {
      headers['X-Session-ID'] = sessionId
    }

    console.log(`Making API request to: ${API_BASE_URL}${endpoint}`)
    
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      if (response.status === 401) {
        // Handle session expiry
        await handleSessionExpiry()
        throw new Error('Session expired')
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    console.error('API request failed:', error)
    
    // Check if this is a session expiry error
    if (error instanceof Error && error.message === 'Session expired') {
      return {
        success: false,
        error: error.message,
        sessionExpired: true
      }
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
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
chrome.action.onClicked.addListener(async (tab) => {
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
          
        case 'hello':
          return { success: true, message: 'Hello from ENX background!' }
          
        default:
          return { success: false, error: 'Unknown action: ' + (request.type || request.action) }
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

  const encodedWord = encodeURIComponent(word.trim())
  const response = await makeApiRequest(`/api/translate?word=${encodedWord}`)
  
  if (response.success) {
    return {
      success: true,
      ecp: response.data.ecp
    }
  } else {
    // Pass through session expiry flag
    return {
      success: false,
      error: response.error,
      sessionExpired: response.sessionExpired
    }
  }
}

// Handle get multiple words
const handleGetWords = async (paragraph: string) => {
  if (!paragraph || paragraph.trim() === '') {
    return { success: false, error: 'No paragraph provided' }
  }

  const encodedParagraph = encodeURIComponent(paragraph)
  const response = await makeApiRequest(`/api/paragraph-init?paragraph=${encodedParagraph}`)
  
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
      wordProperties: response.data
    }
  } else {
    // Pass through session expiry flag
    return {
      success: false,
      error: response.error,
      sessionExpired: response.sessionExpired
    }
  }
}

// Handle mark word as acquainted
const handleMarkAcquainted = async (word: string, userId: number) => {
  if (!word || !userId) {
    return { success: false, error: 'Missing word or userId' }
  }

  const response = await makeApiRequest('/api/mark', {
    method: 'POST',
    body: JSON.stringify({
      word: word.trim(),
      userId
    })
  })
  
  if (response.success) {
    return {
      success: true,
      ecp: response.data.ecp
    }
  } else {
    // Pass through session expiry flag
    return {
      success: false,
      error: response.error,
      sessionExpired: response.sessionExpired
    }
  }
}

// Handle user login
const handleLogin = async (username: string, password: string) => {
  const response = await makeApiRequest('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
  
  if (response.success && response.data) {
    sessionId = response.data.sessionId
    
    // Store session in Chrome storage
    await chrome.storage.local.set({
      user: response.data.user,
      sessionId: response.data.sessionId
    })
    
    console.log('User logged in successfully')
    return {
      success: true,
      data: response.data
    }
  } else {
    return response
  }
}

// Handle user logout
const handleLogout = async () => {
  await makeApiRequest('/api/logout', {
    method: 'POST'
  })
  
  // Clear session regardless of API response
  sessionId = ''
  await chrome.storage.local.remove(['user', 'sessionId'])
  
  console.log('User logged out')
  return { success: true }
}

// Handle service worker errors
self.addEventListener('error', (event) => {
  console.error('ENX Service worker error:', event.error)
})

// Handle unhandled promise rejections
self.addEventListener('unhandledrejection', (event) => {
  console.error('ENX Unhandled promise rejection:', event.reason)
})

// Initialize background script
const initialize = async () => {
  await loadSession()
  console.log('ENX Background script initialization complete')
}

initialize()