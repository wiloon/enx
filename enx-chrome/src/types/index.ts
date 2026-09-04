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
  // string if the model omitted it -- the Side Panel then falls back to a
  // separate 'translateWordInContext' call.
  wordChinese?: string
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
// page's WordPopup. Overwritten on every lookup (no history kept) -- see
// docs/architecture/adr-006-page-word-lookup-in-sidepanel.md. Unlike
// PENDING_SENTENCE_STORAGE_KEY, writing this key never triggers sentence
// translation and never forces the Side Panel open.
export const LATEST_PAGE_WORD_STORAGE_KEY = 'enx-latest-page-word'

export interface LatestPageWordLookup {
  word: string
  ecp: WordData
  createdAt: number
}
