import { ApiResponse, AuthResponse, WordResponse, ParagraphResponse, WordData } from '@/types'

// API Service for ENX extension
export class ApiService {
  private baseUrl: string = 'https://enx-dev.wiloon.com'
  private sessionId: string = ''

  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl
    }
  }

  setSessionId(sessionId: string) {
    this.sessionId = sessionId
  }

  setBaseUrl(url: string) {
    this.baseUrl = url
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      }

      if (this.sessionId) {
        headers['X-Session-ID'] = this.sessionId
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expired')
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      return {
        success: true,
        data,
      }
    } catch (error) {
      console.error('API request failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  // Authentication APIs
  async login(username: string, password: string): Promise<ApiResponse<AuthResponse>> {
    const response = await this.makeRequest<AuthResponse>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })

    if (response.success && response.data) {
      // API returns session_id, not sessionId
      this.sessionId = response.data.session_id || response.data.sessionId || ''
    }

    return response
  }

  async logout(): Promise<ApiResponse<void>> {
    const response = await this.makeRequest<void>('/api/logout', {
      method: 'POST',
    })

    if (response.success) {
      this.sessionId = ''
    }

    return response
  }

  async register(username: string, email: string, password: string): Promise<ApiResponse<AuthResponse>> {
    return this.makeRequest<AuthResponse>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    })
  }

  // Word translation APIs
  async getOneWord(word: string): Promise<ApiResponse<WordResponse>> {
    const encodedWord = encodeURIComponent(word)
    return this.makeRequest<WordResponse>(`/api/translate?word=${encodedWord}`)
  }

  async getWords(paragraph: string): Promise<ApiResponse<ParagraphResponse>> {
    const encodedParagraph = encodeURIComponent(paragraph)
    return this.makeRequest<ParagraphResponse>(`/api/paragraph-init?paragraph=${encodedParagraph}`)
  }

  async markAcquainted(word: string): Promise<ApiResponse<{ ecp: WordData }>> {
    return this.makeRequest<{ ecp: WordData }>('/api/mark', {
      method: 'POST',
      body: JSON.stringify({
        English: word,
      }),
    })
  }

  // Health check
  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    return this.makeRequest<{ status: string }>('/api/health')
  }
}

// Singleton instance
export const apiService = new ApiService()

// Helper functions for chrome extension messaging
export const sendMessageToBackground = <T = any>(message: any): Promise<T> => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else {
        resolve(response)
      }
    })
  })
}

export const sendMessageToTab = <T = any>(tabId: number, message: any): Promise<T> => {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else {
        resolve(response)
      }
    })
  })
}