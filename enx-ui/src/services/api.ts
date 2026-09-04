import {
  ApiResponse,
  BillingMeData,
  CheckoutSessionData,
  RephraseData,
  WordData,
} from '@/types'

export type SubscriptionPlan = 'pro' | 'pro-plus' | 'max'
export type TopupTier = 'small' | 'medium' | 'large'

type TokenGetter = () => Promise<string | null | undefined>

export class ApiService {
  private baseUrl: string =
    process.env.NEXT_PUBLIC_API_BASE_URL || 'https://enx-api.wiloon.lab'
  private accessToken: string = ''
  private tokenGetter?: TokenGetter

  constructor(baseUrl?: string) {
    if (baseUrl) {
      this.baseUrl = baseUrl
    }
  }

  // Test/fallback path: a statically supplied bearer token.
  setAccessToken(token: string) {
    this.accessToken = token
  }

  // App path (ADR-015): Clerk's getToken(), wired by <ApiAuthBridge>. Clerk
  // returns a fresh short-lived session JWT on every call, so there is no
  // refresh cycle for ApiService to manage — a 401 is a real 401.
  setTokenGetter(getter: TokenGetter | undefined) {
    this.tokenGetter = getter
  }

  setBaseUrl(url: string) {
    this.baseUrl = url
  }

  private async authToken(): Promise<string> {
    if (this.tokenGetter) {
      try {
        return (await this.tokenGetter()) || ''
      } catch (error) {
        console.error('Clerk getToken failed:', error)
        return ''
      }
    }
    return this.accessToken
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

      const token = await this.authToken()
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
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

  async getBillingMe(): Promise<ApiResponse<BillingMeData>> {
    return this.makeRequest('/api/billing/me')
  }

  async createSubscriptionCheckout(
    plan: SubscriptionPlan
  ): Promise<ApiResponse<CheckoutSessionData>> {
    return this.makeRequest('/api/billing/checkout/subscription', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    })
  }

  async createTopupCheckout(
    tier: TopupTier
  ): Promise<ApiResponse<CheckoutSessionData>> {
    return this.makeRequest('/api/billing/checkout/topup', {
      method: 'POST',
      body: JSON.stringify({ tier }),
    })
  }

  async createPortalSession(): Promise<ApiResponse<CheckoutSessionData>> {
    return this.makeRequest('/api/billing/portal', { method: 'POST' })
  }

  // Rephrase Chinese / mixed / rough English into idiomatic workplace
  // American English (ADR-012). Billed by actual token usage.
  async rephrase(input: string): Promise<ApiResponse<RephraseData>> {
    return this.makeRequest<RephraseData>('/api/rephrase', {
      method: 'POST',
      body: JSON.stringify({ input }),
    })
  }
}

export const apiService = new ApiService()
