import { SITE } from '@/lib/site'

export default function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24">
      <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
        {SITE.tagline}
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
        {SITE.subtitle}
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href={SITE.chromeWebStoreUrl}
          target="_blank"
          rel="noreferrer"
          className="w-full rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 sm:w-auto"
        >
          Add to Chrome — it&apos;s free
        </a>
        <a
          href="#how-it-works"
          className="w-full rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted sm:w-auto"
        >
          See how it works
        </a>
      </div>
    </section>
  )
}
