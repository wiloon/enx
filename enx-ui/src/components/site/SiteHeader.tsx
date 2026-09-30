import Link from 'next/link'
import { SITE } from '@/lib/site'
import BrandMark from './BrandMark'
import GitHubIcon from './GitHubIcon'
import HeaderAuthLinks from './HeaderAuthLinks'

// Section links are rooted at "/" because the header is also shown on
// /pricing, where a bare "#features" would point nowhere.
const NAV = [
  { label: 'Features', href: '/#features' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Similar apps', href: '/#compare' },
  { label: 'Install', href: '/#install' },
]

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <BrandMark />
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
          <a
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            title="Source code on GitHub"
            className="text-foreground/70 transition-colors hover:text-foreground"
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
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
