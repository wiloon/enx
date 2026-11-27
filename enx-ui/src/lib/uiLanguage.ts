// UI language rules (ADR-096, GLOSSARY "UI language"). Plain values only: the
// proxy, the request config, the language switch and the page metadata call
// these, so the rules run in unit tests without Next, cookies or a browser.

export const UI_LANGUAGES = ['en', 'zh'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

// The UI language whose public pages have no URL prefix (ADR-096 Decision 3).
// A constant: the deployment default (UI_DEFAULT_LANGUAGE) does not move it.
export const UNPREFIXED_UI_LANGUAGE: UiLanguage = 'en'

export function isUiLanguage(value: unknown): value is UiLanguage {
  return (UI_LANGUAGES as readonly unknown[]).includes(value)
}

// Public pages localised in the URL: English unprefixed, Chinese under /zh.
// Each lives under app/[locale]/; add a path here when its page moves there.
export const LOCALISED_PATHS: readonly string[] = [
  '/privacy',
  '/terms',
  '/refund',
]

// Pages without a language prefix that have been translated, so they follow
// the UI language choice (ADR-096 Decision 4). Every other page outside
// [locale] is English whatever the visitor chose.
export const LOCALISED_BY_CHOICE_PATHS: readonly string[] = []

// The unprefixed form of a localised path, accepting a /zh or /en prefix;
// null for any other path.
function localisedPathOf(pathname: string): string | null {
  const match = /^\/(en|zh)(\/.*)$/.exec(pathname)
  const path = match ? match[2] : pathname
  return LOCALISED_PATHS.includes(path) ? path : null
}

export function isLocalisedPath(pathname: string): boolean {
  return localisedPathOf(pathname) !== null
}

export function isLocalisedByChoice(pathname: string): boolean {
  return LOCALISED_BY_CHOICE_PATHS.includes(pathname)
}

// The URL of a localised path in a UI language.
function localisedHref(path: string, language: UiLanguage): string {
  return language === UNPREFIXED_UI_LANGUAGE ? path : `/${language}${path}`
}

// A link on a page in `language`: localised paths keep the page's language,
// every other path stays unprefixed.
export function hrefInUiLanguage(href: string, language: UiLanguage): string {
  const path = href.split(/[?#]/, 1)[0]
  return LOCALISED_PATHS.includes(path) ? localisedHref(href, language) : href
}

export type UiLanguageSwitch =
  { kind: 'navigate'; href: string } | { kind: 'stay' }

// Where choosing `target` in the language switch leads from `pathname`: the
// same page in that language, or nowhere on a page with no Chinese version.
export function uiLanguageSwitch(
  pathname: string,
  target: UiLanguage
): UiLanguageSwitch {
  const path = localisedPathOf(pathname)
  if (path === null) return { kind: 'stay' }
  return { kind: 'navigate', href: localisedHref(path, target) }
}

// The UI language of a page outside [locale]. Only a page localised by choice
// follows the visitor's choice, then the deployment's default; any other page
// is English.
export function uiLanguageOutsideLocale({
  localisedByChoice,
  choice,
  deploymentDefault,
}: {
  localisedByChoice: boolean
  choice: string | undefined
  deploymentDefault: string | undefined
}): UiLanguage {
  if (!localisedByChoice) return 'en'
  if (isUiLanguage(choice)) return choice
  return isUiLanguage(deploymentDefault) ? deploymentDefault : 'en'
}

// Written only by the language switch; opening a /zh URL records nothing.
export const UI_LANGUAGE_CHOICE_COOKIE = 'catglish_ui_language'
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

export function uiLanguageChoiceCookie(language: UiLanguage): string {
  return `${UI_LANGUAGE_CHOICE_COOKIE}=${language}; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax`
}

// Metadata `alternates` of a localised page: its own canonical, and both
// versions for hreflang.
export function localisedAlternates(
  path: string,
  language: UiLanguage
): { canonical: string; languages: Record<UiLanguage, string> } {
  return {
    canonical: localisedHref(path, language),
    languages: {
      en: localisedHref(path, 'en'),
      zh: localisedHref(path, 'zh'),
    },
  }
}
