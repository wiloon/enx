import { notFound } from 'next/navigation'
import RootDocument, { rootMetadata } from '@/components/site/RootDocument'
import { UI_LANGUAGES, isUiLanguage } from '@/lib/uiLanguage'

// Root layout of the public pages localised in the URL (ADR-096 Decision 3):
// /privacy is English (proxy.ts rewrites it to /en/privacy), /zh/privacy
// Chinese. <html lang> comes from the URL, so the pages can be prerendered
// for both languages; any other segment value is a 404.

// Unlike app/(default)/layout.tsx this layout does not force every page to
// render on demand: a force-dynamic layout keeps its pages dynamic even when
// they ask for force-static. Each page here says which it is (the legal pages
// are prerendered).
export const dynamicParams = false

export const metadata = rootMetadata

export function generateStaticParams() {
  return UI_LANGUAGES.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<'/[locale]'>) {
  const { locale } = await params
  if (!isUiLanguage(locale)) notFound()
  return <RootDocument lang={locale}>{children}</RootDocument>
}
