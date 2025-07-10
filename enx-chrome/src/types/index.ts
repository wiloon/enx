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
  isLoggedIn: boolean
}

export interface AuthResponse {
  user: User
  sessionId: string
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
  type: 'getOneWord' | 'getWords' | 'markAcquainted' | 'enxRun' | 'login' | 'logout'
  word?: string
  words?: string
  paragraph?: string
  userId?: number
  username?: string
  password?: string
  data?: any
}

export interface BackgroundResponse {
  success: boolean
  data?: any
  error?: string
  ecp?: WordData
  wordProperties?: Record<string, WordData>
}