import { atom } from 'jotai'
import { WordData } from '@/types'
import { createUserAtom, createSessionAtom } from '@/lib/storageAtoms'
import { config } from '@/config/env'

// Demo counter (keeping for hello world demo)
export const countAtom = atom(0)

// User authentication state with Chrome storage persistence
export const userAtom = createUserAtom()

// Session management with Chrome storage persistence
export const sessionAtom = createSessionAtom()

// Current word being displayed in popup
export const currentWordAtom = atom<WordData | null>(null)

// Loading states
export const isLoadingAtom = atom(false)
export const isTranslatingAtom = atom(false)

// Error state
export const errorAtom = atom<string | null>(null)

// Extension enable state
export const extensionEnabledAtom = atom(false)

// API base URL (can be configured)
export const apiBaseUrlAtom = atom<string>(config.apiBaseUrl)

// Word cache for better performance
export const wordCacheAtom = atom<Record<string, WordData>>({})

// UI state for popup
export const popupVisibleAtom = atom(false)
export const popupPositionAtom = atom<{ x: number; y: number }>({ x: 0, y: 0 })

// Statistics
export const statsAtom = atom({
  wordsLearned: 0,
  totalQueries: 0,
  sessionTime: 0,
})
