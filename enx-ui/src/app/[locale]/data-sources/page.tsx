import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isUiLanguage, localisedAlternates } from '@/lib/uiLanguage'
import DataSourcesPage, { metadata as en } from './DataSourcesEn'
import DataSourcesZhPage, { metadata as zh } from './DataSourcesZh'

// /data-sources (English) and /zh/data-sources (Chinese), ADR-096 Decision 3.
export const dynamic = 'force-static'

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/data-sources'>): Promise<Metadata> {
  const { locale } = await params
  if (!isUiLanguage(locale)) notFound()
  return {
    ...(locale === 'zh' ? zh : en),
    alternates: localisedAlternates('/data-sources', locale),
  }
}

export default async function Page({
  params,
}: PageProps<'/[locale]/data-sources'>) {
  const { locale } = await params
  if (!isUiLanguage(locale)) notFound()
  return locale === 'zh' ? <DataSourcesZhPage /> : <DataSourcesPage />
}
