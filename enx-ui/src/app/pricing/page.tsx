import type { Metadata } from 'next'
import Link from 'next/link'
import SiteHeader from '@/components/site/SiteHeader'
import SiteFooter from '@/components/site/SiteFooter'
import PriceCard from '@/components/site/PriceCard'
import PricingCta from '@/components/site/PricingCta'
import {
  FREE_PLAN,
  SUBSCRIPTION_CREDITS_RULE,
  SUBSCRIPTION_PLANS,
  TOPUP_CREDITS_RULE,
  TOPUP_TIERS,
} from '@/lib/plans'
import { SITE } from '@/lib/site'

// Public pricing page (LAUNCH-CHECKLIST §7.3). Visitors decide before they
// sign up, and Stripe's review expects prices to be visible without an
// account. It only shows prices: checkout lives on the signed-in /billing
// page, which renders the same plans.ts data through the same PriceCard.
// Annual billing is not offered yet (LAUNCH-CHECKLIST §0.3), so none is shown.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: `Pricing — ${SITE.name}`,
  description: `${SITE.name} is free to use. Paid plans add a higher daily lookup limit and monthly AI translation credits.`,
}

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-16 px-4 py-16 sm:px-6">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-bold tracking-tight">Pricing</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Reading, underlines and word lookups are free. Pay only if you want
            AI translation, monthly or as you go.
          </p>
        </header>

        <section aria-labelledby="plans-heading" className="space-y-4">
          <h2 id="plans-heading" className="text-2xl font-semibold">
            Monthly plans
          </h2>
          <p className="text-sm text-muted-foreground">
            {SUBSCRIPTION_CREDITS_RULE} Cancel any time.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <PriceCard
              name={FREE_PLAN.name}
              priceLabel={FREE_PLAN.priceLabel}
              action={<PricingCta label="Get started" variant="outline" />}
            >
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {FREE_PLAN.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{FREE_PLAN.note}</p>
            </PriceCard>
            {SUBSCRIPTION_PLANS.map((option) => (
              <PriceCard
                key={option.plan}
                name={option.name}
                priceLabel={option.priceLabel}
                creditsLabel={option.creditsLabel}
                description={option.description}
                action={<PricingCta label="Subscribe" />}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="topup-heading" className="space-y-4">
          <h2 id="topup-heading" className="text-2xl font-semibold">
            One-time credits
          </h2>
          <p className="text-sm text-muted-foreground">{TOPUP_CREDITS_RULE}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {TOPUP_TIERS.map((option) => (
              <PriceCard
                key={option.tier}
                name={option.name}
                priceLabel={option.priceLabel}
                creditsLabel={option.creditsLabel}
                action={<PricingCta label="Buy" variant="outline" />}
              />
            ))}
          </div>
        </section>

        <p className="text-center text-sm text-muted-foreground">
          Prices in US dollars. See the{' '}
          <Link href="/refund" className="underline hover:text-foreground">
            Refund Policy
          </Link>{' '}
          and{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </>
  )
}
