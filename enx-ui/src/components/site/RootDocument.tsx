import type { Metadata } from 'next'
import { Suspense } from 'react'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { NextIntlClientProvider } from 'next-intl'
import { getAuthAdapter } from '@/auth'
import '@/app/globals.css'
import NavigationProgressBar from '@/components/site/NavigationProgressBar'
import QueryProvider from '@/providers/QueryProvider'
import ApiAuthBridge from '@/providers/ApiAuthBridge'
import ReferralClaimer from '@/providers/ReferralClaimer'
import RuntimeEnvScript from '@/providers/RuntimeEnvScript'
import type { UiLanguage } from '@/lib/uiLanguage'

// The document both root layouts render (ADR-096): app/[locale]/layout.tsx
// with the URL's UI language, app/(default)/layout.tsx with the request
// config's. Each request gets exactly one <html>.

export const rootMetadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'https://enx.wiloon.lab'),
  title: 'Catglish',
  description: 'AI-assisted English reading in your browser.',
}

export default function RootDocument({
  lang,
  children,
}: Readonly<{
  lang: UiLanguage
  children: React.ReactNode
}>) {
  const { Provider: AuthProvider } = getAuthAdapter()
  return (
    <AuthProvider>
      {/* The enx-chrome content script stamps <html data-enx-extension>
          before hydration (ADR-019), so <html>'s own attributes differ from
          the server's by design. This only covers <html> itself, not its
          children. */}
      <html lang={lang} suppressHydrationWarning>
        {/* The rule targets the Pages Router; this is the App Router root
            document, only moved out of layout.tsx so two layouts share it. */}
        {/* eslint-disable-next-line @next/next/no-head-element */}
        <head>
          <RuntimeEnvScript />
        </head>
        <body
          className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
        >
          <NextIntlClientProvider>
            <QueryProvider>
              <ApiAuthBridge />
              <ReferralClaimer />
              <Suspense fallback={null}>
                <NavigationProgressBar />
              </Suspense>
              {children}
            </QueryProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </AuthProvider>
  )
}
