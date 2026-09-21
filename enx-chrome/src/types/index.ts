// Core data types for ENX extension

export interface WordData {
  Key: string
  English: string
  Pronunciation: string
  Chinese: string
  LoadCount: number
  AlreadyAcquainted: number
  WordType: number
}

export interface User {
  id: number
  username: string
  email?: string
  status?: string
  isLoggedIn: boolean
}

export interface AuthResponse {
  user: User
  sessionId?: string
  session_id?: string // API actually returns this field name
  status?: string
  token?: string
}

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface WordResponse {
  ecp: WordData
}

export interface ParagraphResponse {
  wordProperties: Record<string, WordData>
}

export interface PopupPosition {
  x: number
  y: number
}

export interface ContentMessage {
  type:
    | 'getOneWord'
    | 'getWords'
    | 'markAcquainted'
    | 'enxRun'
    | 'login'
    | 'logout'
    | 'openSentencePanel'
    | 'translateSentence'
    | 'translateWordInContext'
    | 'translateSentenceWithWord'
    | 'recordPageWordLookup'
    | 'reportReadingProgress'
    | 'submitPageReport'
  word?: string
  words?: string
  paragraph?: string
  userId?: number
  username?: string
  password?: string
  data?: any
  sentence?: string
  // Set on 'openSentencePanel' by the phrase-in-context lookup (ADR-008): a
  // non-empty phrase means "show a phrase card for this text within
  // `sentence`", not the whole-sentence translation slot. Left unset by the
  // other two 'openSentencePanel' callers (single-word "🔤 整句翻译" button,
  // ADR-007 drag-select-sentence translation).
  phrase?: string
  sourceUrl?: string
  // Set on 'recordPageWordLookup': the already-fetched dictionary result to
  // mirror into the Side Panel (ADR-006), avoiding a second getOneWord call.
  ecp?: WordData
  // Set on 'translateWordInContext': that word's dictionary definition,
  // looked up by the caller BEFORE sending this message (dictionary-first),
  // so the model can explain a divergence instead of guessing blind. Empty
  // when the word has no dictionary entry or the lookup failed.
  dictionaryChinese?: string
  // Set on 'reportReadingProgress' (ADR-028): one reading session's increment
  // to today's counters. Always a delta, never an absolute -- the content
  // script owns the watermark and reports only what it has not reported yet.
  delta?: ReadingStatsDelta
  // Set on 'submitPageReport' (ADR-010 Decision 8): a page the user confirmed
  // they want reported. `url` is already sanitized by the popup; enx-api
  // sanitizes again and does not trust it.
  pageReport?: { url: string; reason: string; adapter: string }
}

// The L0 half of ADR-028's metric set. The other columns of `daily_stats`
// either come from the server (word_lookups, on the metered lookup seam) or
// are v1.1 and still zero everywhere.
export interface ReadingStatsDelta {
  wordsRead?: number
  articlesRead?: number
}

export interface BackgroundResponse {
  success: boolean
  data?: any
  error?: string
  ecp?: WordData
  wordProperties?: Record<string, WordData>
  sessionExpired?: boolean
  // HTTP status of a failed request, when there was one -- 402 (insufficient
  // AI credit) and 429 (daily dictionary quota exceeded) get distinct UI
  // treatment in SidePanel.tsx instead of a generic error message.
  status?: number
  // Set by the 'openSentencePanel' handler: true when the Side Panel is
  // showing the pending sentence -- either chrome.sidePanel.open() succeeded,
  // or the panel was already open for this window (detected via
  // chrome.runtime.getContexts) and picks up the new context through its
  // storage.onChanged listener. False means the caller should fall back to
  // the "click the toolbar ENX icon" hint (the click's user gesture didn't
  // survive being forwarded through runtime.sendMessage -- see
  // TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §3.2 trigger path③).
  panelOpened?: boolean
  // Set by the 'translateSentence' handler on success.
  chinese?: string
  // Set by the 'translateSentenceWithWord' handler (ADR-014) on success: the
  // clicked word's meaning in the sentence's context, returned in the SAME
  // call as `chinese` (the whole-sentence translation). May be an empty
  // string if the model omitted it. Not currently sent by the Side Panel --
  // word context lookups always go through 'translateWordInContext' instead
  // (dictionary-first, so the model has a definition to compare against) --
  // but the endpoint stays available for a future caller.
  wordChinese?: string
  // Set by the 'translateWordInContext' handler: one short clause
  // explaining why the contextual meaning differs from the word's
  // dictionary definition passed in the request. Empty when no dictionary
  // definition was given, or the model judged the contextual meaning
  // unsurprising.
  why?: string
}

// chrome.storage.session key holding the sentence the Side Panel should show.
// Shared constant so content.tsx/background.ts (writers) and SidePanel.tsx
// (reader) can't drift apart on the key name.
export const PENDING_SENTENCE_STORAGE_KEY = 'enx-pending-sentence'

export interface PendingSentenceContext {
  sentence: string
  word: string
  // Non-empty when this context is a phrase-in-context lookup (ADR-008):
  // SidePanel.tsx renders a phrase card for `phrase` within `sentence`
  // instead of running the whole-sentence translation slot. Not reused from
  // `word` deliberately -- `word` is already non-empty for the unrelated
  // single-word "🔤 整句翻译" button flow, and branching SidePanel.tsx on it
  // would change that existing flow's behavior too.
  phrase?: string
  sourceUrl: string
  createdAt: number
}

// chrome.storage.session key holding the most recent word looked up via the
// page's word popover. Overwritten on every lookup (no history kept) -- see
// docs/architecture/adr-006-page-word-lookup-in-sidepanel.md. Unlike
// PENDING_SENTENCE_STORAGE_KEY, writing this key never triggers sentence
// translation and never forces the Side Panel open.
export const LATEST_PAGE_WORD_STORAGE_KEY = 'enx-latest-page-word'

export interface LatestPageWordLookup {
  word: string
  ecp: WordData
  createdAt: number
}
