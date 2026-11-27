import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isUiLanguage, localisedAlternates } from '@/lib/uiLanguage'
import TermsEnPage, { metadata as en } from './TermsEn'
import TermsZhPage, { metadata as zh } from './TermsZh'

// /terms (English) and /zh/terms (Chinese), ADR-096 Decision 3.
export const dynamic = 'force-static'

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/terms'>): Promise<Metadata> {
  const { locale } = await params
  if (!isUiLanguage(locale)) notFound()
  return {
    ...(locale === 'zh' ? zh : en),
    alternates: localisedAlternates('/terms', locale),
  }
}

export default async function TermsPage({
  params,
}: PageProps<'/[locale]/terms'>) {
  const { locale } = await params
  if (!isUiLanguage(locale)) notFound()
  return locale === 'zh' ? <TermsZhPage /> : <TermsEnPage />
}
