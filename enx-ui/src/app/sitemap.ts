import type { MetadataRoute } from 'next'
import { HELP_GUIDES } from '@/lib/help'
import {
  LOCALISED_PATHS,
  UI_LANGUAGES,
  hrefInUiLanguage,
} from '@/lib/uiLanguage'

// Read per request: SITE_URL comes from the container, not from the build.
export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.SITE_URL || 'https://enx.wiloon.lab'
  return [
    { url: `${base}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${base}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    ...['/help', ...HELP_GUIDES.map((guide) => guide.href)].map((path) => ({
      url: `${base}${path}`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    // The legal pages are listed because two review processes (Chrome Web
    // Store, Stripe) go looking for them, and because a policy nobody can
    // find is not published in any meaningful sense.
    // Each language version is a separate URL, not a toggle, so each one can
    // be linked and cited -- and so each one is indexable (ADR-096).
    ...LOCALISED_PATHS.flatMap((path) => {
      const languages = Object.fromEntries(
        UI_LANGUAGES.map((language) => [
          language,
          `${base}${hrefInUiLanguage(path, language)}`,
        ])
      )
      return UI_LANGUAGES.map((language) => ({
        url: languages[language],
        changeFrequency: 'yearly' as const,
        priority: 0.3,
        alternates: { languages },
      }))
    }),
  ]
}
