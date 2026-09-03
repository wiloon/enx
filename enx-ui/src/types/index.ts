export interface User {
  id: string
  username: string
  email?: string
  status?: string
  isLoggedIn: boolean
}

export interface AuthResponse {
  user: User
  sessionId: string
  session_id?: string
  status?: string
  token?: string
}

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface WordData {
  Key: string
  English: string
  Pronunciation: string
  Chinese: string
  LoadCount: number
  AlreadyAcquainted: number
  WordType: number
}

// Mirrors GET /api/billing/me (enx-api/billing/handler.go Me). Status is
// "none" | "active" | "past_due" | "canceled" -- see ADR-009's subscriptions
// table, aligned with Stripe's own subscription.status values.
export interface BillingSubscription {
  status: string
  plan: string
  currentPeriodEnd: number
}

export interface BillingCredits {
  subscriptionBalance: number
  topupBalance: number
}

export interface BillingMeData {
  subscription: BillingSubscription
  credits: BillingCredits
}

export interface CheckoutSessionData {
  url: string
}

// Mirrors POST /api/rephrase (enx-api aitranslate RephraseHandler, ADR-012).
// The idiomatic rendering plus 1-2 alternatives at different registers and
// 0-4 Chinese learning notes. Notes are Chinese by design (learning content);
// everything else is English UI copy.
export interface RephraseAlternative {
  text: string
  register: string
}

export interface RephraseData {
  idiomatic: string
  alternatives: RephraseAlternative[]
  notes: string[]
}