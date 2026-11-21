/**
 * When the popup stats card should nudge the user about AI credits
 * (ADR-052 Decision 2). Pure: fixed clock, no I/O.
 */

export interface BillingInputs {
  subscriptionBalance: number
  topupBalance: number
  trialBalance: number
  /** Unix seconds; null when the account never had a trial. */
  trialExpiresAt: number | null
  subscriptionStatus: string
  /** Absent from older APIs — callers may omit it; we fall back to 20. */
  lowBalanceThreshold?: number
}

export interface CreditNotice {
  text: string
  href: '/billing'
}

const DEFAULT_LOW_BALANCE_THRESHOLD = 20
const MS_PER_HOUR = 60 * 60 * 1000

export function creditNotice(
  billing: BillingInputs,
  now: Date
): CreditNotice | null {
  const nowMs = now.getTime()
  const nowSec = nowMs / 1000

  // ADR-048 Decision 8: treat the trial pool as 0 once expired.
  let trialBalance = billing.trialBalance
  if (
    billing.trialExpiresAt != null &&
    nowSec >= billing.trialExpiresAt
  ) {
    trialBalance = 0
  }

  const subscriptionBalance = billing.subscriptionBalance
  const topupBalance = billing.topupBalance
  const B = subscriptionBalance + topupBalance + trialBalance
  const threshold =
    billing.lowBalanceThreshold === undefined
      ? DEFAULT_LOW_BALANCE_THRESHOLD
      : billing.lowBalanceThreshold

  // 1. Trial expiring: trial-only, trialBalance > 0, 0 < expiry − now ≤ 48h.
  const trialOnly =
    subscriptionBalance === 0 && topupBalance === 0 && trialBalance > 0
  if (trialOnly && billing.trialExpiresAt != null) {
    const remainingMs = billing.trialExpiresAt * 1000 - nowMs
    if (remainingMs > 0 && remainingMs <= 48 * MS_PER_HOUR) {
      if (remainingMs < 24 * MS_PER_HOUR) {
        const hours = Math.max(1, Math.ceil(remainingMs / MS_PER_HOUR))
        const unit = hours === 1 ? 'hour' : 'hours'
        return {
          text: `Trial credits expire in ${hours} ${unit}`,
          href: '/billing',
        }
      }
      return { text: 'Trial credits expire tomorrow', href: '/billing' }
    }
  }

  // 2. Subscriber out of credits.
  const subscribed =
    billing.subscriptionStatus === 'active' ||
    billing.subscriptionStatus === 'past_due'
  if (subscribed && B <= 0) {
    return { text: 'Out of AI credits · Get more', href: '/billing' }
  }

  // 3. Low balance (threshold 0 turns this off).
  if (threshold > 0 && B > 0 && B <= threshold) {
    return {
      text: `Only ${B} AI credits left · Get more`,
      href: '/billing',
    }
  }

  return null
}
