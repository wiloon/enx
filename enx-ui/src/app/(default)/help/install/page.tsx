import type { Metadata } from 'next'
import Link from 'next/link'
import HelpScreenshot from '@/components/help/HelpScreenshot'
import { ENHANCED_PROTECTION_NOTE } from '@/lib/help'
import { SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: `Install from the Chrome Web Store — ${SITE.name}`,
}

export default function InstallPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          Install from the Chrome Web Store
        </h1>
        <p className="text-lg text-muted-foreground">
          Add {SITE.name} to desktop Chrome, then finish setup on the Welcome
          page.
        </p>
        <p>
          Can’t access the store?{' '}
          <Link href="/help/install/offline">
            Install manually from a ZIP file
          </Link>
          .
        </p>
      </header>
      <section aria-labelledby="find" className="space-y-4">
        <h2 id="find" className="text-xl font-semibold">
          1. Find {SITE.name}
        </h2>
        <p>
          <a
            href="https://chromewebstore.google.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the Chrome Web Store
          </a>
          . Search for {SITE.name.toUpperCase()} and choose the {SITE.name}{' '}
          extension.
        </p>
        <p>
          Prefer a direct link?{' '}
          <a
            href={SITE.chromeWebStoreUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open the {SITE.name} listing
          </a>
          .
        </p>
        <HelpScreenshot
          file="install/store-search.png"
          caption={`Chrome Web Store search results with the ${SITE.name} extension highlighted.`}
        />
      </section>
      <section aria-labelledby="add" className="space-y-4">
        <h2 id="add" className="text-xl font-semibold">
          2. Add the extension
        </h2>
        <p>
          On the listing, click <strong>Add to Chrome</strong>.
        </p>
        <HelpScreenshot
          file="install/store-listing.png"
          caption={`The ${SITE.name} listing with Add to Chrome highlighted.`}
        />
        <aside
          aria-label="Enhanced protection installation note"
          className="space-y-3 rounded-xl border border-warning bg-warning-muted p-4 text-warning-foreground"
        >
          <p>{ENHANCED_PROTECTION_NOTE}</p>
          <p>
            <a
              href="https://support.google.com/chrome/answer/2664769"
              target="_blank"
              rel="noopener noreferrer"
            >
              Read Chrome’s explanation of Enhanced protection
            </a>
            .
          </p>
          <HelpScreenshot
            file="install/enhanced-protection.png"
            caption="The Proceed with caution dialog with Continue to install highlighted."
          />
        </aside>
        <p>
          In the permissions dialog, review the requested permissions and click{' '}
          <strong>Add extension</strong> to confirm.
        </p>
        <HelpScreenshot
          file="install/add-extension.png"
          caption="The permissions dialog with Add extension highlighted."
        />
      </section>
      <section aria-labelledby="finish" className="space-y-4">
        <h2 id="finish" className="text-xl font-semibold">
          3. Continue on the Welcome page
        </h2>
        <p>
          After installation, {SITE.name} opens the Welcome page or switches
          back to it if it is already open. Sign in, pin the icon and try the
          sample article there.
        </p>
        <p>
          <Link href="/welcome">Continue setup</Link> ·{' '}
          <Link href="/help/get-started">Read the getting-started guide</Link>
        </p>
      </section>
    </article>
  )
}
