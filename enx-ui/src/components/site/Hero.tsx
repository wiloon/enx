import Link from 'next/link'
import { SITE } from '@/lib/site'
import { SUBSCRIPTION_PLANS } from '@/lib/plans'
import ChromeStoreCta from './ChromeStoreCta'

const PRIMARY =
  'w-full rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90 sm:w-auto'

export default function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 pb-10 text-center sm:px-6 sm:pt-24">
      <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:max-w-none">
        {SITE.tagline}
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
        {SITE.subtitle}
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <ChromeStoreCta
          className={PRIMARY}
          installed={
            <Link href={SITE.appPath} className={PRIMARY}>
              Go to app <span aria-hidden="true">→</span>
            </Link>
          }
        >
          Add to Chrome — it&apos;s free
        </ChromeStoreCta>
        <a
          href="#how-it-works"
          className="w-full rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted sm:w-auto"
        >
          See how it works
        </a>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Free to use · AI translation plans from{' '}
        {SUBSCRIPTION_PLANS[0].priceLabel} ·{' '}
        <Link href="/pricing" className="underline hover:text-foreground">
          See pricing
        </Link>
      </p>
    </section>
  )
}
