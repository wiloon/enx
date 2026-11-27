// The explanation language controls (ADR-098 Decision 1): what the word
// popover's switch and the Options dropdown show for a given cached copy,
// read result and save result. The value itself lives on the server.

import type {
  PreferencesData,
  PreferencesResult,
} from '@/lib/serverPreferences'

// The languages this version of the extension understands. The server may
// hold one it doesn't; that selects nothing and is never rewritten.
export const EXPLANATION_LANGUAGES = [
  // 中 is the language's own mark (ADR-098), not Chinese UI copy.
  { value: 'zh-Hans', mark: '中', name: 'Simplified Chinese' },
  { value: 'en', mark: 'EN', name: 'English' },
] as const

export const SAVE_FAILED_MESSAGE = "Couldn't save the explanation language."

export type ExplanationLanguageState = {
  read: 'loading' | 'ready' | 'unavailable' | 'signed-out'
  // What the server last said: the cached copy until the read answers.
  preferences: PreferencesData | null
  // The value being saved, or null when no save is in flight.
  saving: string | null
  saveFailed: boolean
}

export const openingState = (
  cached: PreferencesData | null
): ExplanationLanguageState => ({
  read: 'loading',
  preferences: cached,
  saving: null,
  saveFailed: false,
})

export const afterRead = (
  state: ExplanationLanguageState,
  result: PreferencesResult
): ExplanationLanguageState =>
  result.ok
    ? { ...state, read: 'ready', preferences: result.data }
    : {
        ...state,
        read: result.reason === 'signed-out' ? 'signed-out' : 'unavailable',
      }

export const saveStarted = (
  state: ExplanationLanguageState,
  value: string
): ExplanationLanguageState => ({
  ...state,
  saving: value,
  saveFailed: false,
})

// Success shows what the server answered; failure goes back to the stored
// value.
export const afterSave = (
  state: ExplanationLanguageState,
  result: PreferencesResult
): ExplanationLanguageState =>
  result.ok
    ? { ...state, preferences: result.data, saving: null }
    : { ...state, saving: null, saveFailed: true }

export type ExplanationLanguageControl = {
  // null: the value is one this version doesn't know.
  selected: string | null
  disabled: boolean
}

// null means no control at all: signed out, or neither the server nor the
// cache has the preference (an older server).
export const explanationLanguageControl = ({
  read,
  preferences,
  saving,
}: ExplanationLanguageState): ExplanationLanguageControl | null => {
  const member = preferences?.explanationLanguage
  if (read === 'signed-out' || !member) return null
  const value = saving ?? member.effective
  return {
    selected: EXPLANATION_LANGUAGES.some(l => l.value === value) ? value : null,
    disabled: read !== 'ready' || saving !== null || !member.editable,
  }
}
