import {
  AdminEcdictRow,
  AdminWordRow,
  ApiResponse,
  BillingMeData,
  CheckoutSessionData,
  MeData,
  ReaderDocument,
  ReaderDocumentSummary,
  RephraseData,
  StatsOverview,
  StatsPeriod,
  StatsSeries,
  WordData,
} from '@/types'

export type SubscriptionPlan = 'pro' | 'pro-plus' | 'max'
export type TopupTier = 'small' | 'medium' | 'large'

type TokenGetter = () => Promise<string | null | undefined>

// The caller's own calendar day as YYYY-MM-DD. toISOString() would give the
// UTC day, which is a different day for most of the world for part of every
// day -- and getting it wrong shows up as yesterday's reading on today's
// chart, which nobody would think to question.
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export class ApiService {
  // Same-origin by design: endpoints below are already /api/*, and
  // next.config.ts rewrites those to the real API host at request time. That
  // keeps the API host out of the JS bundle (so one image runs in any
  // environment) and sidesteps CORS entirely.
  private baseUrl: string = ''
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
        // The server files reading statistics under the user's own calendar
        // day, which only the client knows (ADR-029 Decision 7a). Sent on
        // every request, not just the stats ones: a word looked up from
        // /lookup counts too, and a header that is only sometimes present is
        // a header that is sometimes wrong.
        'X-Enx-Tz-Offset': String(-new Date().getTimezoneOffset()),
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

  async getMe(): Promise<ApiResponse<MeData>> {
    return this.makeRequest('/api/me')
  }

  // Reading statistics (ADR-028). Neither endpoint looks up a word, calls a
  // model or touches credits, so both sit outside ADR-018's metering seam.
  async getStatsOverview(): Promise<ApiResponse<StatsOverview>> {
    return this.makeRequest(`/api/stats/overview?date=${localDate()}`)
  }

  async getStatsSeries(
    period: StatsPeriod,
    from: string,
    to: string
  ): Promise<ApiResponse<StatsSeries>> {
    const params = new URLSearchParams({ period, from, to })
    return this.makeRequest(`/api/stats/series?${params}`)
  }

  // Admin dictionary maintenance (ADR-021). Each of these hits a dedicated
  // admin-only endpoint (RequireAdmin) that returns the raw table row — no
  // metering, no words/ECDICT merge, no backfill.
  async adminGetWord(word: string): Promise<ApiResponse<AdminWordRow>> {
    return this.makeRequest(`/api/admin/words/${encodeURIComponent(word)}`)
  }

  async adminGetEcdict(word: string): Promise<ApiResponse<AdminEcdictRow>> {
    return this.makeRequest(`/api/admin/ecdict/${encodeURIComponent(word)}`)
  }

  async adminSyncWordFromEcdict(word: string): Promise<
    ApiResponse<{ success: boolean; matchedBy: string; word: AdminWordRow }>
  > {
    return this.makeRequest(
      `/api/admin/words/${encodeURIComponent(word)}/sync-from-ecdict`,
      { method: 'POST' }
    )
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

  // Reader "paste text" documents (ADR-022). Length (20,000 chars) and the
  // 50-document-per-user cap are enforced server-side; this client sends
  // whatever it's given and surfaces the backend's rejection message.
  async createReaderDocument(content: string): Promise<ApiResponse<{ id: string }>> {
    return this.makeRequest('/api/reader/documents', {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  }

  async listReaderDocuments(): Promise<
    ApiResponse<{ documents: ReaderDocumentSummary[] }>
  > {
    return this.makeRequest('/api/reader/documents')
  }

  async getReaderDocument(id: string): Promise<ApiResponse<ReaderDocument>> {
    return this.makeRequest(`/api/reader/documents/${encodeURIComponent(id)}`)
  }

  // Replaces a saved document's content in place and resets its 7-day TTL
  // (ADR-022 Addendum: this is what "Edit" on an already-saved document
  // does -- as opposed to createReaderDocument, which always makes a new
  // document).
  async updateReaderDocument(
    id: string,
    content: string
  ): Promise<ApiResponse<ReaderDocument>> {
    return this.makeRequest(`/api/reader/documents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    })
  }

  async deleteReaderDocument(
    id: string
  ): Promise<ApiResponse<{ success: boolean }>> {
    return this.makeRequest(`/api/reader/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }
}

export const apiService = new ApiService()
