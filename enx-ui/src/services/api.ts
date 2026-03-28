import { ApiResponse, WordData } from '@/types'

export class ApiService {
  private baseUrl: string =
    process.env.NEXT_PUBLIC_API_BASE_URL || 'https://enx-dev.wiloon.com'
  private accessToken: string = ''

  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl
    }
  }

  setAccessToken(token: string) {
    this.accessToken = token
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
        ...((options.headers as Record<string, string>) || {}),
      }

      if (this.accessToken) {
        headers['Authorization'] = `Bearer ${this.accessToken}`
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Session expired')
        }
        const errorBody = await response.json().catch(() => null)
        const message =
          errorBody?.error ||
          errorBody?.message ||
          `HTTP ${response.status}: ${response.statusText}`
        throw new Error(message)
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

  async getMe(): Promise<
    ApiResponse<{ id: string; name: string; email: string; status: string }>
  > {
    return this.makeRequest('/api/me')
  }

  async lookupWord(word: string): Promise<ApiResponse<WordData>> {
    return this.makeRequest<WordData>(`/api/word/${encodeURIComponent(word)}`)
  }

  async deleteWord(
    word: string
  ): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return this.makeRequest(`/api/word/${encodeURIComponent(word)}`, {
      method: 'DELETE',
    })
  }
}

export const apiService = new ApiService()
