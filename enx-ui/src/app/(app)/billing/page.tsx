'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import PriceCard from '@/components/site/PriceCard'
import { apiService, SubscriptionPlan, TopupTier } from '@/services/api'
import {
  SUBSCRIPTION_CREDITS_RULE,
  SUBSCRIPTION_PLANS,
  TOPUP_CREDITS_RULE,
  TOPUP_TIERS,
  subscriptionStatusLabel,
} from '@/lib/plans'

type BillingTab = 'subscription' | 'topup'

const TABS: { id: BillingTab; label: string }[] = [
  { id: 'subscription', label: 'Monthly subscription' },
  { id: 'topup', label: 'One-time credits' },
]

export default function BillingPage() {
  const [tab, setTab] = useState<BillingTab>('subscription')
  // Tracks which button (if any) triggered a checkout/portal redirect, so
  // only that button shows "Redirecting..." and every button disables while a
  // redirect is in flight (avoids a second click firing a second Checkout
  // Session before the page navigates away).
  const [redirecting, setRedirecting] = useState<string | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['billing-me'],
    queryFn: async () => {
      const resp = await apiService.getBillingMe()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load billing status')
    },
  })

  const goToCheckout = async (
    key: string,
    request: () => ReturnType<typeof apiService.createSubscriptionCheckout>
  ) => {
    setCheckoutError(null)
    setRedirecting(key)
    const resp = await request()
    if (resp.success && resp.data?.url) {
      window.location.assign(resp.data.url)
      return
    }
    setCheckoutError(
      resp.error || 'Could not start checkout. Please try again later.'
    )
    setRedirecting(null)
  }

  const handleSubscribe = (plan: SubscriptionPlan) =>
    goToCheckout(`subscription-${plan}`, () =>
      apiService.createSubscriptionCheckout(plan)
    )

  const handleTopup = (tier: TopupTier) =>
    goToCheckout(`topup-${tier}`, () => apiService.createTopupCheckout(tier))

  const handleManageBilling = () =>
    goToCheckout('portal', () => apiService.createPortalSession())

  const status = data?.subscription.status ?? 'none'
  const isActive = status === 'active'
  const badgeVariant =
    status === 'active'
      ? 'default'
      : status === 'past_due'
        ? 'destructive'
        : 'secondary'

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Subscription &amp; Credits</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Current status
            {!isLoading && !error && (
              <Badge variant={badgeVariant}>
                {subscriptionStatusLabel(status, data?.subscription.plan)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-muted-foreground">Loading...</p>}
          {error && (
            <p className="text-destructive">
              {error instanceof Error
                ? error.message
                : 'Failed to load billing status'}
            </p>
          )}
          {data && (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">
                  Subscription credit balance
                </div>
                <div className="text-lg font-medium">
                  {data.credits.subscriptionBalance}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  Top-up credit balance
                </div>
                <div className="text-lg font-medium">
                  {data.credits.topupBalance}
                </div>
              </div>
            </div>
          )}
        </CardContent>
        {(status === 'active' || status === 'past_due') && (
          <CardFooter>
            <Button
              variant="outline"
              onClick={handleManageBilling}
              disabled={redirecting !== null}
            >
              {redirecting === 'portal'
                ? 'Redirecting...'
                : 'Manage subscription / billing'}
            </Button>
          </CardFooter>
        )}
      </Card>

      {checkoutError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {checkoutError}
        </div>
      )}

      <div
        role="tablist"
        aria-label="Billing options"
        className="inline-flex rounded-lg bg-muted p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`billing-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`billing-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'subscription' && (
        <section
          role="tabpanel"
          id="billing-panel-subscription"
          aria-labelledby="billing-tab-subscription"
          className="space-y-3"
        >
          <p className="text-sm text-muted-foreground">
            {SUBSCRIPTION_CREDITS_RULE}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SUBSCRIPTION_PLANS.map((option) => (
              <PriceCard
                key={option.plan}
                name={option.name}
                priceLabel={option.priceLabel}
                creditsLabel={option.creditsLabel}
                description={option.description}
                action={
                  <Button
                    className="w-full"
                    onClick={() => handleSubscribe(option.plan)}
                    disabled={isActive || redirecting !== null}
                  >
                    {redirecting === `subscription-${option.plan}`
                      ? 'Redirecting...'
                      : isActive
                        ? 'Subscribed'
                        : 'Subscribe'}
                  </Button>
                }
              />
            ))}
          </div>
        </section>
      )}

      {tab === 'topup' && (
        <section
          role="tabpanel"
          id="billing-panel-topup"
          aria-labelledby="billing-tab-topup"
          className="space-y-3"
        >
          <p className="text-sm text-muted-foreground">{TOPUP_CREDITS_RULE}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TOPUP_TIERS.map((option) => (
              <PriceCard
                key={option.tier}
                name={option.name}
                priceLabel={option.priceLabel}
                creditsLabel={option.creditsLabel}
                action={
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => handleTopup(option.tier)}
                    disabled={redirecting !== null}
                  >
                    {redirecting === `topup-${option.tier}`
                      ? 'Redirecting...'
                      : 'Buy'}
                  </Button>
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
