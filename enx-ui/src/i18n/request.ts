import { cookies } from 'next/headers'
import { locale as localeSegment } from 'next/root-params'
import { getRequestConfig } from 'next-intl/server'
import {
  UI_LANGUAGE_CHOICE_COOKIE,
  isUiLanguage,
  uiLanguageOutsideLocale,
  type UiLanguage,
} from '@/lib/uiLanguage'

// next-intl's request config, for both kinds of page (ADR-096):
// - under app/[locale]/ the URL's segment decides, so the page can stay
//   statically rendered (nothing here reads the request);
// - outside it (app/(default)/) the page has no segment, and its UI language
//   comes from lib/uiLanguage.ts.
export default getRequestConfig(async ({ locale: explicit }) => {
  const segment = explicit ?? (await localeSegment())
  const uiLanguage = isUiLanguage(segment)
    ? segment
    : await uiLanguageOfPageOutsideLocale()
  return {
    locale: uiLanguage,
    messages: (await import(`../../messages/${uiLanguage}.json`)).default,
  }
})

async function uiLanguageOfPageOutsideLocale(): Promise<UiLanguage> {
  return uiLanguageOutsideLocale({
    // No page is localised by choice yet (LOCALISED_BY_CHOICE_PATHS is
    // empty). The first one, the sign-in page, also passes the current path
    // here to look it up.
    localisedByChoice: false,
    choice: (await cookies()).get(UI_LANGUAGE_CHOICE_COOKIE)?.value,
    deploymentDefault: process.env.UI_DEFAULT_LANGUAGE,
  })
}
