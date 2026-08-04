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
  word?: string
  words?: string
  paragraph?: string
  userId?: number
  username?: string
  password?: string
  data?: any
  sentence?: string
  sourceUrl?: string
}

export interface BackgroundResponse {
  success: boolean
  data?: any
  error?: string
  ecp?: WordData
  wordProperties?: Record<string, WordData>
  sessionExpired?: boolean
  // Set by the 'openSentencePanel' handler: whether chrome.sidePanel.open()
  // actually succeeded (it may fail if the click's user gesture didn't
  // survive being forwarded through runtime.sendMessage -- see
  // TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md §3.2 trigger path③).
  panelOpened?: boolean
  // Set by the 'translateSentence' handler on success.
  chinese?: string
}

// chrome.storage.session key holding the sentence the Side Panel should show.
// Shared constant so content.tsx/background.ts (writers) and SidePanel.tsx
// (reader) can't drift apart on the key name.
export const PENDING_SENTENCE_STORAGE_KEY = 'enx-pending-sentence'

export interface PendingSentenceContext {
  sentence: string
  word: string
  sourceUrl: string
  createdAt: number
}
