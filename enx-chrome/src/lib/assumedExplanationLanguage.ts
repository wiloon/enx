// The explanation language the extension currently assumes (ADR-098 Decision 8).
// Learned from cached preferences and from server answers; a missing value on
// an older server is treated as zh-Hans for storage and does not change it.

export type ExplanationLanguage = 'zh-Hans' | 'en'

export const DEFAULT_EXPLANATION_LANGUAGE: ExplanationLanguage = 'zh-Hans'

export const asExplanationLanguage = (
  value: unknown
): ExplanationLanguage | undefined =>
  value === 'en' || value === 'zh-Hans' ? value : undefined

// No preference value means zh-Hans.
export const languageFromPreferences = (
  effective: unknown
): ExplanationLanguage => asExplanationLanguage(effective) ?? DEFAULT_EXPLANATION_LANGUAGE

// A response language updates the assumption; an absent one (older server)
// leaves it alone. The caller still stores that answer under zh-Hans.
export const applyResponseLanguage = (
  assumed: ExplanationLanguage,
  responseLanguage: unknown
): ExplanationLanguage =>
  asExplanationLanguage(responseLanguage) ?? assumed

export const storageLanguageForResponse = (
  responseLanguage: unknown
): ExplanationLanguage =>
  asExplanationLanguage(responseLanguage) ?? DEFAULT_EXPLANATION_LANGUAGE
