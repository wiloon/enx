import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://enx.wiloon.lab'
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/app' },
    sitemap: `${base}/sitemap.xml`,
  }
}
