import SiteHeader from '@/components/site/SiteHeader'
import SiteFooter from '@/components/site/SiteFooter'
import { LEGAL } from '@/lib/legal'

// Shared shell for /privacy, /terms and /refund. The three pages are long
// prose, so the typography lives here once rather than as the same dozen
// utility classes repeated on every heading in three files.

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string
  intro: string
  children: React.ReactNode
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-muted-foreground">{intro}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated: {LEGAL.effectiveDate}
        </p>
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
