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

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  // The HTTP status of a non-2xx answer; absent when no answer came back.
  status?: number
  // Set only when fetch itself got no answer. A missing status alone does
  // not mean that: a disabled account or a broken 2xx body has none either.
  networkFailure?: boolean
}

export interface WordData {
  Id: string
  Key: string
  English: string
  Pronunciation: string
  Chinese: string
  LoadCount: number
  Known: boolean
  WordType: number
  // Which source answered the lookup GET (ADR-040): "local", "ecdict",
  // "miss", "timeout" or "error". Absent from an older API, and other
  // values may arrive from a newer one.
  Source?: string
}

// Mirrors GET /api/billing/me (enx-api/billing/handler.go Me). Status is
// Stripe's raw subscription.status string (e.g. "active", "trialing",
// "past_due", "incomplete", "unpaid", "canceled"), or "none" for a user who
// never subscribed. Other Stripe values can arrive too, so it stays a string.
export interface BillingSubscription {
  status: string
  plan: string
  currentPeriodEnd: number
}

export interface BillingCredits {
  subscriptionBalance: number
  topupBalance: number
  // The sign-up trial (ADR-048): 0 once spent or expired.
  trialBalance: number
  // Unix seconds; null for an account that never had a trial.
  trialExpiresAt: number | null
}

export interface BillingMeData {
  subscription: BillingSubscription
  credits: BillingCredits
}

// Invite links (ADR-051), mirroring enx-api handlers/referral.go. Times are
// Unix seconds.
export interface ReferralPendingReward {
  amount: number
  dueAt: number
}

// GET /api/referral/me
export interface ReferralMeData {
  code: string
  link: string
  invited: number
  paid: number
  pendingRewards: ReferralPendingReward[]
  totalEarned: number
}

// POST /api/referral/claim. bonus 0 and trialExpiresAt null when the invitee
// bonus is switched off.
export interface ReferralClaimData {
  bonus: number
  trialExpiresAt: number | null
}

// GET /api/referral/offer: what an invitee gets, for the landing page.
export interface ReferralOffer {
  credits: number
  days: number
}

// GET/PUT /api/me/preferences (enx-api preferences, ADR-044). `value` is the
// user's explicit choice (null = unset, the default applies); `effective` is
// what the server acts on, with the default and the user's entitlement
// applied -- show it, never recompute it; `editable` is whether the user may
// change it (false for a user who can't use AI at all).
export interface PreferenceView {
  value: boolean | null
  effective: boolean
  editable: boolean
}

export type PreferenceKey =
  | 'aiWordFallback'
  | 'aiWordFallbackNoticeAck'
  // ADR-047: written by /welcome, never shown on the settings page.
  | 'onboardingCompleted'

export type PreferencesData = Record<PreferenceKey, PreferenceView>

// A partial update: null returns the key to its default.
export type PreferenceChanges = Partial<Record<PreferenceKey, boolean | null>>

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

// A build's version: enx-api's GET /api/version (GetVersionSimple, stamped via
// ldflags), or enx-ui's own, baked into its image (lib/buildVersion.ts).
export interface VersionData {
  version: string
  commit: string
  build_time: string
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
  // Where the definition first came from, and when an admin last edited or
  // approved it (absent = never) -- ADR-045. An AI row no admin has edited is
  // hidden from users who can't use AI.
  source?: 'ecdict' | 'ai'
  adminEditedAt?: number | null
  // AI rows only: the model's own 0-10 confidence and the prompt version.
  aiQuality?: number
  aiPromptVersion?: string
  // Users who have the word in their vocabulary, and the lookups they made of
  // it. loadCount above is not maintained and is always 0; these are real.
  users?: number
  lookups?: number
}

// GET /api/admin/ai-words (ADR-045): the AI-made definitions waiting for an
// admin, busiest first. `total` counts every match, not just this page.
export interface AdminAiWordsPage {
  words: AdminWordRow[]
  total: number
}

// GET /api/admin/ecdict/:word (ADR-021): the matched ECDICT stardict row plus
// which fallback strategy hit ("exact" | "sw" | "exchange"; "exact" is
// case-insensitive, stardict.word being COLLATE NOCASE).
export interface AdminEcdictRow {
  found: boolean
  matchedBy?: string
  word?: string
  sw?: string
  phonetic?: string
  translation?: string
  exchange?: string
}

// GET /api/admin/users (ADR-049 Decision 11). Balances and totals are
// credits; money amounts stay in Stripe. Times are RFC 3339 UTC.
export type AdminUserSort = 'created' | 'last_login' | 'balance'

export interface AdminUserSummary {
  id: string
  email: string
  name: string
  // users.status: 'active', or 'disabled' by an admin (ADR-062).
  status: string
  createdAt: string | null
  lastLoginAt: string | null
  plan: string
  subscriptionStatus: string
  balances: {
    subscription: number
    topup: number
    // 0 once the trial has expired.
    trial: number
    trialExpiresAt: string | null
    total: number
  }
  totals: {
    paid: number
    gifted: number
    trial: number
    consumed: number
    clawedBack: number
  }
  hadClawback: boolean
}

export interface AdminUsersPage {
  users: AdminUserSummary[]
  total: number
}

// GET /api/admin/users/:id
export interface AdminUserDetail {
  user: AdminUserSummary & {
    stripeCustomerId: string
    stripeDashboardUrl: string
  }
  // The last 30 UTC days, oldest first, zero-filled.
  dailyLookups: { date: string; count: number }[]
  // Last 30 days, most spent first.
  aiSpend: { feature: string; credits: number }[]
}

// GET /api/admin/users/:id/transactions, newest first. `next` is the cursor
// for the following page, '' on the last one.
export interface AdminLedgerEntry {
  id: string
  type: string
  amount: number
  balanceAfter: number
  feature: string
  note: string
  createdAt: string
  // stripe | admin | refund | trial | referral | ai | other
  source: string
}

export interface AdminLedgerPage {
  transactions: AdminLedgerEntry[]
  next: string
}

// POST /api/admin/credits/grant and /deduct.
export interface AdminCreditAdjustment {
  email: string
  amount: number
  reason: string
}

// GET /api/admin/page-reports (ADR-010 Decision 11): newest page reports first.
export interface AdminPageReport {
  id: string
  userId: string
  url: string
  host: string
  reason: string
  adapter: string
  extVersion: string
  createdAt: number
}

// Reader "paste text" documents (ADR-022): 20,000-char limit, 7-day TTL, 50
// documents per user (oldest evicted on write) -- all enforced server-side.
// Editing a document (ADR-022 Addendum) bumps `updatedAt` and resets the
// TTL; lists sort by `updatedAt`, not `createdAt`.
// GET /api/me/words: one word the user looked up in an article (a
// user_dicts row), including the ones marked known.
export type WordListStatus = 'all' | 'learning' | 'known'
// recent: last looked up first; lookups: most looked up first.
export type WordListSort = 'recent' | 'lookups'

export interface WordListEntry {
  english: string
  chinese: string
  pronunciation: string
  queryCount: number
  known: boolean
  firstLookedUpAt: string
  // Only a lookup moves it; marking a word known does not.
  lastLookedUpAt: string
}

// POST /api/mark answers with the word after the toggle.
export interface MarkedWord {
  English: string
  Known: boolean
  LoadCount: number
}

export interface WordListPage {
  total: number
  words: WordListEntry[]
}

// GET /api/saved-pages (ADR-032): a page the user saved from the extension
// popup. URL and title only.
export interface SavedPage {
  id: string
  url: string
  title: string
  host: string
  createdAt: string
}

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
