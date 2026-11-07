import { SITE } from '@/lib/site'
import BrandMark from './BrandMark'
import ChromeStoreCta from './ChromeStoreCta'
import GitHubIcon from './GitHubIcon'
import HeaderAuthLinks from './HeaderAuthLinks'
import HomeLink from './HomeLink'
import SiteMobileMenu from './SiteMobileMenu'
import { SITE_NAV } from './siteNav'

// Left: the section links you read (SITE_NAV). Right: GitHub as an icon, Sign
// in and the one solid CTA, the things you do. Nav text is neutral so brand
// colour stays on the CTA (docs/agents/ui-design.md). Below lg the section
// links and GitHub move into SiteMobileMenu, and below sm the CTA joins them.
const quietLink =
  'rounded-sm text-sm text-foreground/70 transition-colors hover:text-foreground active:text-foreground/80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring'

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
        <HomeLink className="flex shrink-0 items-center gap-2 font-semibold">
          <BrandMark />
        </HomeLink>

        <nav
          aria-label="Main"
          className="hidden flex-1 items-center gap-6 lg:flex"
        >
          {SITE_NAV.map((item) => (
            <a key={item.href} href={item.href} className={quietLink}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 sm:gap-4 lg:ml-0">
          <a
            href={SITE.githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            title="GitHub"
            className={`hidden lg:inline-flex ${quietLink}`}
          >
            <GitHubIcon className="h-5 w-5" />
          </a>
          <HeaderAuthLinks />
          <ChromeStoreCta className="hidden whitespace-nowrap rounded-md sm:inline-block bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            Add to Chrome
          </ChromeStoreCta>
          <SiteMobileMenu />
        </div>
      </div>
    </header>
  )
}
