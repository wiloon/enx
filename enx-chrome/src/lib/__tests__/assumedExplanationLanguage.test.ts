import {
  applyResponseLanguage,
  languageFromPreferences,
  storageLanguageForResponse,
} from '../assumedExplanationLanguage'

it('reads zh-Hans when the preference is missing', () => {
  expect(languageFromPreferences(undefined)).toBe('zh-Hans')
  expect(languageFromPreferences(null)).toBe('zh-Hans')
  expect(languageFromPreferences('en')).toBe('en')
})

it('updates the assumption only when the response names a language', () => {
  expect(applyResponseLanguage('en', undefined)).toBe('en')
  expect(applyResponseLanguage('en', 'zh-Hans')).toBe('zh-Hans')
  expect(applyResponseLanguage('zh-Hans', 'en')).toBe('en')
})

it('stores an answer without ExplanationLanguage under zh-Hans', () => {
  expect(storageLanguageForResponse(undefined)).toBe('zh-Hans')
  expect(storageLanguageForResponse('en')).toBe('en')
})
