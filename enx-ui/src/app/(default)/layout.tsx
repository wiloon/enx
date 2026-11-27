import { getLocale } from 'next-intl/server'
import RootDocument, { rootMetadata } from '@/components/site/RootDocument'

// Root layout of every page outside app/[locale]/: no language in the URL, so
// the request config decides the UI language (English unless the page is
// localised by choice, lib/uiLanguage.ts).

// Nothing may be prerendered: a statically rendered page would freeze the
// build machine's env into the HTML, defeating the runtime config below.
export const dynamic = 'force-dynamic'

export const metadata = rootMetadata

export default async function DefaultLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <RootDocument lang={await getLocale()}>{children}</RootDocument>
}
