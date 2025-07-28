import { ApiResponse, AuthResponse, WordData } from '@/types'

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

  async login(username: string, password: string): Promise<ApiResponse<AuthResponse>> {
    const response = await this.makeRequest<AuthResponse>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })

    if (response.success && response.data) {
      this.sessionId = response.data.sessionId
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

  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    return this.makeRequest<{ status: string }>('/api/health')
  }

  async lookupWord(word: string): Promise<ApiResponse<WordData>> {
    return this.makeRequest<WordData>(`/api/word/${encodeURIComponent(word)}`)
  }
}

export const apiService = new ApiService()