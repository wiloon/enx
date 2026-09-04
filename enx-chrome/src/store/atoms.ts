import { atom } from 'jotai'
import { WordData } from '@/types'
import { createUserAtom } from '@/lib/storageAtoms'
import { config } from '@/config/env'

// Demo counter (keeping for hello world demo)
export const countAtom = atom(0)

// User profile mirror of the Clerk session (ADR-015), populated in the popup by
// <ClerkUserSync>. Consumers read user.isLoggedIn / user.username.
export const userAtom = createUserAtom()

// Current word being displayed in popup
export const currentWordAtom = atom<WordData | null>(null)

// Loading states
export const isLoadingAtom = atom(false)
export const isTranslatingAtom = atom(false)

// Error state
export const errorAtom = atom<string | null>(null)

// Shown in the word popup when "整句翻译" was clicked but chrome.sidePanel.open()
// could not be triggered directly (see TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md
// §3.2 trigger path③) -- null hides the hint.
export const sentencePanelHintAtom = atom<string | null>(null)

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
