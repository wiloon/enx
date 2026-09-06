import { SubscriptionPlan, TopupTier } from '@/services/api'

// Credit numbers are deliberately left as placeholders (TBD) -- the
// per-tier monthly credit allowance isn't finalized yet, and the backend
// config (stripe.credits.subscription-*) is still 0 until it is (see
// w10n-config/enx/HANDOFF-stripe-billing-integration.md §4.2, private).
// Prices ARE final enough to show: three tiers replaced the original
// single "enx Pro" monthly/annual structure on 2026-08-26 (still
// provisional numbers, subject to change before general availability, but
// no longer "undecided" -- see w10n-config/enx/monetization-tasks.md).
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
    name: 'enx Pro',
    priceLabel: '$3/mo',
    creditsLabel: PLACEHOLDER,
    description: '无限查词 + 每月 AI 翻译积分',
  },
  {
    plan: 'pro-plus',
    name: 'enx Pro+',
    priceLabel: '$10/mo',
    creditsLabel: PLACEHOLDER,
    description: '无限查词 + 更多每月 AI 翻译积分',
  },
  {
    plan: 'max',
    name: 'enx Max',
    priceLabel: '$20/mo',
    creditsLabel: PLACEHOLDER,
    description: '无限查词 + 最多每月 AI 翻译积分',
  },
]

export interface TopupOption {
  tier: TopupTier
  name: string
  priceLabel: string
  creditsLabel: string
}

export const TOPUP_TIERS: TopupOption[] = [
  { tier: 'small', name: '小额充值', priceLabel: PLACEHOLDER, creditsLabel: PLACEHOLDER },
  { tier: 'medium', name: '中额充值', priceLabel: PLACEHOLDER, creditsLabel: PLACEHOLDER },
  { tier: 'large', name: '大额充值', priceLabel: PLACEHOLDER, creditsLabel: PLACEHOLDER },
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
      return `${planName} 会员`
    case 'past_due':
      return '订阅逾期'
    case 'canceled':
      return '已取消'
    default:
      return '免费用户'
  }
}
