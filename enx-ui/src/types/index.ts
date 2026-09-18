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
  Id: string
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

// Reader "paste text" documents (ADR-022): 20,000-char limit, 7-day TTL, 50
// documents per user (oldest evicted on write) -- all enforced server-side.
// Editing a document (ADR-022 Addendum) bumps `updatedAt` and resets the
// TTL; lists sort by `updatedAt`, not `createdAt`.
export interface ReaderDocumentSummary {
  id: string
  createdAt: string
  updatedAt: string
  preview: string
}

export interface ReaderDocument {
  id: string
  content: string
  createdAt: string
  expiresAt: string
}
// Reading statistics (ADR-028). Every number here is a day-grained aggregate
// over the user's OWN local days -- the server stores no URL, no page title
// and no timestamp, so there is nothing else it could return.
//
// `wordsRead` and `articlesRead` are estimates inferred from where the user
// clicked and scrolled, not measurements; the UI has to say so and must not
// render them to a precision they don't have (ADR-028 Decision 8).
export interface StatsTotals {
  wordsRead: number
  articlesRead: number
  wordLookups: number
  newWords: number
  wordsMastered: number
  phraseLookups: number
  sentenceTranslations: number
  contextLookups: number
}

export interface StatsVocab {
  total: number
  mastered: number
}

// "Words I touched recently", not strictly "words I looked up recently":
// the underlying ordering is by user_dicts.updated_at, which marking a word
// known also bumps (ADR-028 Decision 7).
export interface StatsRecentWord {
  english: string
  chinese: string
  queryCount: number
}

// GET /api/stats/overview
export interface StatsOverview {
  today: StatsTotals
  week: StatsTotals
  sparkline: number[]
  vocab: StatsVocab
  recent: StatsRecentWord[]
}

// The bucket size of a series. The server zero-fills empty buckets rather
// than skipping them, so a gap in the data is a gap in the chart and not a
// straight line across a week the user did not read (ADR-028 Decision 6).
export type StatsPeriod = 'day' | 'week' | 'month' | 'year'

export interface StatsPoint {
  date: string
  totals: StatsTotals
}

// GET /api/stats/series
export interface StatsSeries {
  period: StatsPeriod
  points: StatsPoint[]
}
