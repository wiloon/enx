import { SITE } from '@/lib/site'

export default function CtaBanner() {
  return (
    <section className="border-y border-border/60 bg-brand/5">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-14 text-center sm:px-6">
        <p className="text-xl font-semibold">
          Free to install. Your vocabulary, building itself as you read.
        </p>
        <a
          href={SITE.chromeWebStoreUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
        >
          Add to Chrome
        </a>
      </div>
    </section>
  )
}
