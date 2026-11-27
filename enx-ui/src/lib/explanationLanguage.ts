// The explanation language dropdown on the settings page (ADR-098 Decision 1).

import type { ExplanationLanguageView } from '@/types'

// The languages this build understands. The server may hold one it doesn't;
// that selects nothing and is never rewritten.
export const EXPLANATION_LANGUAGES = [
  { value: 'zh-Hans', name: 'Simplified Chinese' },
  { value: 'en', name: 'English' },
] as const

// What the dropdown selects: the value being saved while a save is in flight,
// otherwise what the server acts on. '' for a value this build doesn't know.
export const selectedExplanationLanguage = (
  preference: ExplanationLanguageView,
  saving: string | null
): string => {
  const value = saving ?? preference.effective
  return EXPLANATION_LANGUAGES.some((l) => l.value === value) ? value : ''
}
