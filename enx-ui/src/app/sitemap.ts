import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://enx.wiloon.lab'
  return [
    { url: `${base}/`, changeFrequency: 'monthly', priority: 1 },
    // The legal pages are listed because two review processes (Chrome Web
    // Store, Stripe) go looking for them, and because a policy nobody can
    // find is not published in any meaningful sense.
    { url: `${base}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/refund`, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
