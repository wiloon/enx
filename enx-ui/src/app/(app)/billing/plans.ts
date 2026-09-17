import { SubscriptionPlan, TopupTier } from '@/services/api'

// Credit numbers are deliberately left as placeholders (TBD) -- the
// per-tier monthly credit allowance isn't finalized yet, and the backend
// config (stripe.credits.subscription-*) is still 0 until it is (see
// w10n-config/enx/HANDOFF-stripe-billing-integration.md §4.2, private).
// Prices ARE final enough to show: three tiers replaced the original
// single "enx Pro" monthly/annual structure on 2026-08-26 (still
// provisional numbers, subject to change before general availability, but
// no longer "undecided" -- see w10n-config/enx/monetization-tasks.md).
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
    priceLabel: '$3/mo',
    creditsLabel: PLACEHOLDER,
    description: 'A much higher daily lookup limit + monthly AI translation credits',
  },
  {
    plan: 'pro-plus',
    name: 'Catglish Pro+',
    priceLabel: '$10/mo',
    creditsLabel: PLACEHOLDER,
    description: 'A much higher daily lookup limit + more monthly AI translation credits',
  },
  {
    plan: 'max',
    name: 'Catglish Max',
    priceLabel: '$20/mo',
    creditsLabel: PLACEHOLDER,
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
  { tier: 'small', name: 'Small top-up', priceLabel: PLACEHOLDER, creditsLabel: PLACEHOLDER },
  { tier: 'medium', name: 'Medium top-up', priceLabel: PLACEHOLDER, creditsLabel: PLACEHOLDER },
  { tier: 'large', name: 'Large top-up', priceLabel: PLACEHOLDER, creditsLabel: PLACEHOLDER },
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
