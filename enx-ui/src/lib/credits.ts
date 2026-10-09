import type { BillingCredits } from '@/types'

// Everything the user can spend right now: both paid pools plus the sign-up
// trial, which the API already reports as 0 once it has expired (ADR-048).
export function totalCredits(credits: BillingCredits): number {
  return (
    credits.subscriptionBalance + credits.topupBalance + credits.trialBalance
  )
}

// "100 trial credits · expires Oct 15", or null when there is no trial left
// to mention.
export function trialSummary(
  credits: BillingCredits,
  now: Date = new Date()
): string | null {
  const { trialBalance, trialExpiresAt } = credits
  if (trialBalance <= 0 || trialExpiresAt === null) return null
  const expires = new Date(trialExpiresAt * 1000)
  if (expires <= now) return null
  const date = expires.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  return `${trialBalance.toLocaleString('en-US')} trial credits · expires ${date}`
}
