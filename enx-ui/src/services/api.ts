import { ApiResponse, WordData } from '@/types'
import { CognitoTokens, refreshCognitoTokens } from '@/lib/cognito'

export class ApiService {
  private baseUrl: string =
    process.env.NEXT_PUBLIC_API_BASE_URL || 'https://enx-dev.wiloon.com'
  private accessToken: string = ''
  private refreshToken: string = ''
  private refreshInFlight: Promise<CognitoTokens> | null = null
  private onTokensRefreshed?: (tokens: CognitoTokens) => void

  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl
    }
  }

  setAccessToken(token: string) {
    this.accessToken = token
  }

  setRefreshToken(token: string) {
    this.refreshToken = token
  }

  setOnTokensRefreshed(callback: (tokens: CognitoTokens) => void) {
    this.onTokensRefreshed = callback
  }

  setBaseUrl(url: string) {
    this.baseUrl = url
  }

  // Silently exchange the refresh token for a new access token. Concurrent
  // 401s share a single in-flight refresh via `refreshInFlight`, so a burst
  // of simultaneous requests doesn't fire multiple refresh calls.
  private async tryRefreshTokens(): Promise<boolean> {
    if (!this.refreshToken) {
      return false
    }

    if (!this.refreshInFlight) {
      this.refreshInFlight = refreshCognitoTokens(this.refreshToken).finally(
        () => {
          this.refreshInFlight = null
        }
      )
    }

    try {
      const tokens = await this.refreshInFlight
      this.accessToken = tokens.access_token
      if (tokens.refresh_token) {
        this.refreshToken = tokens.refresh_token
      }
      this.onTokensRefreshed?.(tokens)
      return true
    } catch (error) {
      console.error('Token refresh failed:', error)
      return false
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    isRetry = false
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
          if (!isRetry && (await this.tryRefreshTokens())) {
            return this.makeRequest<T>(endpoint, options, true)
          }
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
