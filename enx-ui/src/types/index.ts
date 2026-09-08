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

// GET /api/me (enx-api GetMe). isAdmin reflects the ADMIN_CLERK_USER_IDS
// allowlist (ADR-021) and is the only signal the UI uses to decide whether
// to show the admin navigation.
export interface MeData {
  id: string
  name: string
  email: string
  status: string
  isAdmin: boolean
}

// GET /api/admin/words/:word (ADR-021): the raw words-table row, tombstones
// (deletedAt) included. `found` is false when the word is not in the table.
export interface AdminWordRow {
  found: boolean
  id?: string
  english?: string
  chinese?: string
  pronunciation?: string
  loadCount?: number
  createdAt?: number
  updatedAt?: number
  deletedAt?: number | null
}

// GET /api/admin/ecdict/:word (ADR-021): the matched ECDICT stardict row plus
// which fallback strategy hit ("exact" | "lower" | "sw" | "exchange").
export interface AdminEcdictRow {
  found: boolean
  matchedBy?: string
  word?: string
  sw?: string
  phonetic?: string
  translation?: string
  exchange?: string
}