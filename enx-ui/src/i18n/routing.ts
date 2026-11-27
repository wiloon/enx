import { defineRouting } from 'next-intl/routing'
import { UI_LANGUAGES, UNPREFIXED_UI_LANGUAGE } from '@/lib/uiLanguage'

// next-intl routing for the pages under app/[locale]/ (ADR-096 Decision 3):
// English unprefixed, Chinese under /zh, /en/... redirected to the unprefixed
// URL. Only the URL decides: no Accept-Language or cookie detection, and no
// next-intl cookie (the UI language choice cookie is the switch's alone).
export const routing = defineRouting({
  locales: UI_LANGUAGES,
  defaultLocale: UNPREFIXED_UI_LANGUAGE,
  localePrefix: 'as-needed',
  localeDetection: false,
  localeCookie: false,
  // The pages' metadata carries hreflang (lib/uiLanguage.ts).
  alternateLinks: false,
})
