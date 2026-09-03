import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://enx.wiloon.lab'
  return [{ url: `${base}/`, changeFrequency: 'monthly', priority: 1 }]
}
