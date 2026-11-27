import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isUiLanguage, localisedAlternates } from '@/lib/uiLanguage'
import PrivacyPolicyPage, { metadata as en } from './PrivacyEn'
import PrivacyPolicyZhPage, { metadata as zh } from './PrivacyZh'

// /privacy (English) and /zh/privacy (Chinese), ADR-096 Decision 3.
export const dynamic = 'force-static'

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/privacy'>): Promise<Metadata> {
  const { locale } = await params
  if (!isUiLanguage(locale)) notFound()
  return {
    ...(locale === 'zh' ? zh : en),
    alternates: localisedAlternates('/privacy', locale),
  }
}

export default async function PrivacyPage({
  params,
}: PageProps<'/[locale]/privacy'>) {
  const { locale } = await params
  if (!isUiLanguage(locale)) notFound()
  return locale === 'zh' ? <PrivacyPolicyZhPage /> : <PrivacyPolicyPage />
}
