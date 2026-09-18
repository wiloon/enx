import { SubscriptionPlan, TopupTier } from '@/services/api'

// These numbers are what a real visitor is charged, so they must match the
// Stripe catalog EXACTLY:
//   prices  -> w10n-config/infra/stripe/opentofu/enx/variables.tf
//   credits -> enx-api/config.toml [stripe.credits]
// Changing one without the others means the page advertises one thing and
// the card is charged another. All three were set together on 2026-09-17.
//
// The values are provisional and will be revisited after a few weeks of real
// usage (see w10n-config/enx/pricing-decision-2026-09.md), but they are no
// longer placeholders -- production is publicly reachable and a stranger can
// subscribe.
//
// Lookups are not "unlimited" on any tier: every tier has a daily ceiling,
// subscribers just get a far higher one (ADR-029).
export const PLACEHOLDER = 'TBD'

export interface PlanOption {
  plan: SubscriptionPlan
  name: string
  priceLabel: string
  creditsLabel: string
  description: string
}

export const SUBSCRIPTION_PLANS: PlanOption[] = [
  {
    plan: 'pro',
    name: 'Catglish Pro',
    priceLabel: '$3.99/mo',
    creditsLabel: '500 credits/mo',
    description: 'A much higher daily lookup limit + monthly AI translation credits',
  },
  {
    plan: 'pro-plus',
    name: 'Catglish Pro+',
    priceLabel: '$9.99/mo',
    creditsLabel: '1,500 credits/mo',
    description: 'A much higher daily lookup limit + more monthly AI translation credits',
  },
  {
    plan: 'max',
    name: 'Catglish Max',
    priceLabel: '$19.99/mo',
    creditsLabel: '4,000 credits/mo',
    description: 'A much higher daily lookup limit + maximum monthly AI translation credits',
  },
]

export interface TopupOption {
  tier: TopupTier
  name: string
  priceLabel: string
  creditsLabel: string
}

export const TOPUP_TIERS: TopupOption[] = [
  { tier: 'small', name: 'Small top-up', priceLabel: '$2.99', creditsLabel: '300 credits' },
  { tier: 'medium', name: 'Medium top-up', priceLabel: '$6.99', creditsLabel: '750 credits' },
  { tier: 'large', name: 'Large top-up', priceLabel: '$12.99', creditsLabel: '1,500 credits' },
]

const PLAN_NAMES: Record<string, string> = {
  pro: 'Pro',
  'pro-plus': 'Pro+',
  max: 'Max',
}

export function subscriptionStatusLabel(status: string, plan?: string): string {
  const planName = (plan && PLAN_NAMES[plan]) || 'Pro'
  switch (status) {
    case 'active':
      return `${planName} member`
    case 'past_due':
      return 'Subscription past due'
    case 'canceled':
      return 'Canceled'
    default:
      return 'Free user'
  }
}
