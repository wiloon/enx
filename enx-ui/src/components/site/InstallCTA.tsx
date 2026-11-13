import Link from 'next/link'
import { SITE } from '@/lib/site'
import ChromeStoreCta from './ChromeStoreCta'

const PRIMARY =
  'rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 active:opacity-80'
const OUTLINE =
  'rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted active:bg-muted/80'

// The page's closing call to action. Like the Hero, it follows the extension
// check, so a reader who already has Catglish is sent to the app instead of
// the store.
export default function InstallCTA() {
  // Read SITE at render time so tests (and a later store launch) see the
  // current urls.
  const browsers = [
    { name: 'Edge', url: SITE.edgeAddonUrl },
    { name: 'Firefox', url: SITE.firefoxAddonUrl },
  ]
  const available = browsers.filter((b) => b.url)
  const comingSoon = browsers.filter((b) => !b.url).map((b) => b.name)

  return (
    <section
      id="install"
      className="scroll-mt-16 border-y border-border/60 bg-brand/5"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-3xl font-bold tracking-tight">
          Start reading with Catglish
        </h2>
        <p className="mt-3 text-muted-foreground">
          Free to install. Your vocabulary, building itself as you read.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <ChromeStoreCta
            className={PRIMARY}
            installed={
              <Link href={SITE.appPath} className={PRIMARY}>
                Go to app <span aria-hidden="true">→</span>
              </Link>
            }
          >
            Add to Chrome
          </ChromeStoreCta>
          {available.map((b) => (
            <a
              key={b.name}
              href={b.url}
              target="_blank"
              rel="noreferrer"
              className={OUTLINE}
            >
              {b.name}
            </a>
          ))}
        </div>
        {comingSoon.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            {comingSoon.join(' and ')} coming soon.
          </p>
        )}
      </div>
    </section>
  )
}
