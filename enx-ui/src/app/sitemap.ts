import type { MetadataRoute } from 'next'

// Read per request: SITE_URL comes from the container, not from the build.
export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.SITE_URL || 'https://enx.wiloon.lab'
  return [
    { url: `${base}/`, changeFrequency: 'monthly', priority: 1 },
    // The legal pages are listed because two review processes (Chrome Web
    // Store, Stripe) go looking for them, and because a policy nobody can
    // find is not published in any meaningful sense.
    ...['/privacy', '/terms', '/refund'].flatMap((path) => [
      { url: `${base}${path}`, changeFrequency: 'yearly' as const, priority: 0.3 },
      // The Chinese versions are separate URLs, not a toggle, so each one
      // can be linked and cited -- and so each one is indexable.
      { url: `${base}/zh${path}`, changeFrequency: 'yearly' as const, priority: 0.3 },
    ]),
  ]
}
