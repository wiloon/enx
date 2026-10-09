import { SITE } from '@/lib/site'
import BrandMark from './BrandMark'
import ChromeStoreCta from './ChromeStoreCta'
import HeaderAuthLinks from './HeaderAuthLinks'
import HomeLink from './HomeLink'

// Section links are rooted at "/" because the header is also shown on
// /pricing, where a bare "#features" would point nowhere. External links open
// in a new tab.
const NAV: { label: string; href: string; external?: boolean }[] = [
  { label: 'Features', href: '/#features' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Similar apps', href: '/#compare' },
  { label: 'Install', href: '/#install' },
  { label: 'GitHub', href: SITE.githubUrl, external: true },
]

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <HomeLink className="flex items-center gap-2 font-semibold">
          <BrandMark />
        </HomeLink>

        <nav className="hidden flex-1 items-center gap-6 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              {...(item.external && { target: '_blank', rel: 'noreferrer' })}
              className="text-sm text-foreground/70 transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 sm:gap-4 md:ml-0">
          <HeaderAuthLinks />
          <ChromeStoreCta className="whitespace-nowrap rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90">
            Add to Chrome
          </ChromeStoreCta>
        </div>
      </div>
    </header>
  )
}
