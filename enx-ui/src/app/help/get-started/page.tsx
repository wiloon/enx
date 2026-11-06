import type { Metadata } from 'next'
import Link from 'next/link'
import HelpScreenshot from '@/components/help/HelpScreenshot'
import { SITE } from '@/lib/site'

export const metadata: Metadata = { title: `Get started — ${SITE.name}` }

export default function GetStartedPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          Get started with {SITE.name}
        </h1>
        <p className="text-lg text-muted-foreground">
          Pin the icon, sign in and try your first word lookup.
        </p>
        <p>
          Need the extension first?{' '}
          <Link href="/help/install">Install from the Chrome Web Store</Link> or{' '}
          <Link href="/help/install/offline">
            install manually from a ZIP file
          </Link>
          .
        </p>
      </header>
      <section aria-labelledby="pin" className="space-y-4">
        <h2 id="pin" className="text-xl font-semibold">
          1. Pin the icon to Chrome’s toolbar
        </h2>
        <p>
          Click the puzzle-piece icon to the right of Chrome’s address bar, then
          click the pin next to {SITE.name}. The {SITE.name} icon will stay on
          the toolbar, ready whenever you want to read.
        </p>
        <HelpScreenshot
          file="get-started/pin-extension.png"
          caption={`Chrome’s extensions menu with the pin next to ${SITE.name} highlighted.`}
        />
      </section>
      <section aria-labelledby="sign-in" className="space-y-4">
        <h2 id="sign-in" className="text-xl font-semibold">
          2. Sign in
        </h2>
        <p>
          <Link href="/welcome">Open Welcome</Link> and choose{' '}
          <strong>Sign in</strong>, or <strong>Sign up</strong> if you do not
          have an account. After signing in, you return to Welcome to continue
          setup. The extension uses the same account.
        </p>
      </section>
      <section aria-labelledby="enable" className="space-y-4">
        <h2 id="enable" className="text-xl font-semibold">
          3. Turn on {SITE.name} for the sample article
        </h2>
        <p>
          Keep Welcome open with its sample article visible. Click the{' '}
          {SITE.name} icon in Chrome’s toolbar, then choose{' '}
          <strong>Read with {SITE.name}</strong>.
        </p>
        <HelpScreenshot
          file="get-started/enable-reading.png"
          caption={`The ${SITE.name} popup with Read with ${SITE.name} highlighted.`}
        />
      </section>
      <section aria-labelledby="lookup" className="space-y-4">
        <h2 id="lookup" className="text-xl font-semibold">
          4. Look up your first word
        </h2>
        <p>
          Click a word you don’t know in the sample article to see its meaning.
          Words you look up join your Word List so you can return to them later.
        </p>
        <HelpScreenshot
          file="get-started/word-lookup.png"
          caption="A word’s meaning shown beside the selected word in the sample article."
        />
        <p>
          On another English article, click the toolbar icon and choose{' '}
          <strong>Read with {SITE.name}</strong> again to start reading with it
          on that page.
        </p>
        <p>
          If you have already completed or skipped setup, Welcome may show the
          finished page. You can still try the sample article there.
        </p>
      </section>
    </article>
  )
}
