import type { MetadataRoute } from 'next'

// Read per request: SITE_URL comes from the container, not from the build.
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const base = process.env.SITE_URL || 'https://enx.wiloon.lab'
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/app' },
    sitemap: `${base}/sitemap.xml`,
  }
}
