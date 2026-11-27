import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isUiLanguage, localisedAlternates } from '@/lib/uiLanguage'
import RefundPolicyPage, { metadata as en } from './RefundEn'
import RefundPolicyZhPage, { metadata as zh } from './RefundZh'

// /refund (English) and /zh/refund (Chinese), ADR-096 Decision 3.
export const dynamic = 'force-static'

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/refund'>): Promise<Metadata> {
  const { locale } = await params
  if (!isUiLanguage(locale)) notFound()
  return {
    ...(locale === 'zh' ? zh : en),
    alternates: localisedAlternates('/refund', locale),
  }
}

export default async function RefundPage({
  params,
}: PageProps<'/[locale]/refund'>) {
  const { locale } = await params
  if (!isUiLanguage(locale)) notFound()
  return locale === 'zh' ? <RefundPolicyZhPage /> : <RefundPolicyPage />
}
