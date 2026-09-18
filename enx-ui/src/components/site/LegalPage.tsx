import Link from 'next/link'
import SiteHeader from '@/components/site/SiteHeader'
import SiteFooter from '@/components/site/SiteFooter'
import { LEGAL } from '@/lib/legal'

// Shared shell for the legal pages, in both languages. The prose is long, so
// the typography lives here once rather than as the same dozen utility
// classes repeated on every heading in six files.

export type Locale = 'en' | 'zh'

/**
 * The Chinese pages live under /zh/... rather than being a toggle on the
 * same URL, so each version has an address that can be linked, bookmarked
 * and cited. Which matters here more than on an ordinary page: "the terms
 * you agreed to" has to be a thing you can point at.
 */
export function zhHref(enHref: string): string {
  return `/zh${enHref}`
}

const STRINGS = {
  en: {
    lastUpdated: 'Last updated',
    otherLanguage: '中文',
    otherLanguageLabel: 'Read this page in Chinese',
    translationNote: null as string | null,
  },
  zh: {
    lastUpdated: '最后更新',
    otherLanguage: 'English',
    otherLanguageLabel: '用英文阅读本页',
    // Says which version governs. Without this, two translations that drift
    // leave it genuinely unclear which one the reader agreed to.
    translationNote:
      '本页为英文版的中文翻译。两版如有出入，以中文版为准。',
  },
} as const

export function LegalPage({
  title,
  intro,
  locale,
  /** The English path for this document, e.g. "/privacy". */
  enHref,
  children,
}: {
  title: string
  intro: string
  locale: Locale
  enHref: string
  children: React.ReactNode
}) {
  const t = STRINGS[locale]
  const otherHref = locale === 'en' ? zhHref(enHref) : enHref

  return (
    <>
      <SiteHeader />
      <main
        className="mx-auto max-w-3xl px-4 py-12 sm:px-6"
        lang={locale === 'zh' ? 'zh-Hans' : 'en'}
      >
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <Link
            href={otherHref}
            aria-label={t.otherLanguageLabel}
            className="mt-1.5 shrink-0 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {t.otherLanguage}
          </Link>
        </div>

        <p className="mt-3 text-muted-foreground">{intro}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.lastUpdated}: {LEGAL.effectiveDate}
        </p>

        {t.translationNote && (
          <p className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            {t.translationNote}
          </p>
        )}

        <div className="mt-10 space-y-8">{children}</div>
      </main>
      <SiteFooter />
    </>
  )
}

export function Section({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{heading}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  )
}

export function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

/** A term being defined, or a value the reader should be able to spot. */
export function Term({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>
}
