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

export interface WordData {
  Key: string
  English: string
  Pronunciation: string
  Chinese: string
  LoadCount: number
  AlreadyAcquainted: number
  WordType: number
}