import { SITE } from '@/lib/site'

function BrowserButton({
  name,
  url,
  primary,
}: {
  name: string
  url: string
  primary?: boolean
}) {
  if (!url) {
    return (
      <span className="rounded-md border border-dashed border-border px-5 py-2.5 text-sm text-muted-foreground">
        {name} — coming soon
      </span>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={
        primary
          ? 'rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90'
          : 'rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted'
      }
    >
      {name}
    </a>
  )
}

export default function InstallCTA() {
  return (
    <section id="install" className="scroll-mt-16 mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
      <h2 className="text-3xl font-bold tracking-tight">Start reading with Catseye</h2>
      <p className="mt-3 text-muted-foreground">
        Free to install. Your vocabulary, building itself as you read.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <BrowserButton name="Add to Chrome" url={SITE.chromeWebStoreUrl} primary />
        <BrowserButton name="Edge" url={SITE.edgeAddonUrl} />
        <BrowserButton name="Firefox" url={SITE.firefoxAddonUrl} />
      </div>
    </section>
  )
}
