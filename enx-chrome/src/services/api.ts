import {
  ApiResponse,
  WordResponse,
  ParagraphResponse,
  WordData,
} from '@/types'
import { getApiBaseUrl } from '@/config/env'

export class ApiService {
  private accessToken: string = ''

  constructor(_baseUrl?: string) {
    // Base URL resolved per-request via getApiBaseUrl()
  }

  setAccessToken(token: string) {
    this.accessToken = token
  }

  setBaseUrl(_url: string) {
    // API base URL comes from chrome.storage / env via getApiBaseUrl()
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const base = await getApiBaseUrl()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      }

      if (this.accessToken) {
        headers['Authorization'] = `Bearer ${this.accessToken}`
      }

      const response = await fetch(`${base}${endpoint}`, {
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
      return { success: true, data }
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

  async getOneWord(word: string): Promise<ApiResponse<WordResponse>> {
    return this.makeRequest<WordResponse>(
      `/api/translate?word=${encodeURIComponent(word)}`
    )
  }

  async getWords(paragraph: string): Promise<ApiResponse<ParagraphResponse>> {
    return this.makeRequest<ParagraphResponse>(
      `/api/paragraph-init?paragraph=${encodeURIComponent(paragraph)}`
    )
  }

  async markAcquainted(word: string): Promise<ApiResponse<{ ecp: WordData }>> {
    return this.makeRequest<{ ecp: WordData }>('/api/mark', {
      method: 'POST',
      body: JSON.stringify({ English: word }),
    })
  }

  async validateSession(): Promise<ApiResponse<unknown>> {
    return this.makeRequest('/api/me')
  }
}

export const apiService = new ApiService()

export const sendMessageToBackground = <T = unknown>(message: unknown): Promise<T> => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else {
        resolve(response as T)
      }
    })
  })
}
