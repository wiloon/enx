import Link from 'next/link'
import { SITE } from '@/lib/site'
import HeaderAuthLinks from './HeaderAuthLinks'

const NAV = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Compare', href: '#compare' },
  { label: 'Install', href: '#install' },
]

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden
            className="inline-block h-5 w-5 rounded-full bg-brand ring-2 ring-brand/25"
          />
          {SITE.name}
        </Link>

        <nav className="hidden flex-1 items-center gap-6 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-foreground/70 transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4 md:ml-0">
          <HeaderAuthLinks />
          <a
            href={SITE.chromeWebStoreUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
          >
            Add to Chrome
          </a>
        </div>
      </div>
    </header>
  )
}
