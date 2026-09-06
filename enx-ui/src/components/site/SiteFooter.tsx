import Link from 'next/link'
import { SITE } from '@/lib/site'

export default function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3 sm:px-6">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <span aria-hidden className="inline-block h-4 w-4 rounded-full bg-brand" />
            {SITE.name}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            AI-assisted English reading in your browser.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-medium">Product</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <a href={SITE.chromeWebStoreUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
                Add to Chrome
              </a>
            </li>
            <li>
              <Link href={SITE.appPath} className="hover:text-foreground">
                Open App
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-medium">Resources</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <a href={SITE.githubUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
                GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        © {year} {SITE.name}
      </div>
    </footer>
  )
}
