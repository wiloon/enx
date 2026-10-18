import type {
  ApiResponse,
  ReferralClaimData,
  ReferralOffer,
  ReferralPendingReward,
} from '@/types'

// Invite links (ADR-051 Decision 2): the /invite/<code> landing page keeps
// the code in localStorage until the visitor is signed in, then the app
// claims it once and forgets it, whatever the outcome.

export const REFERRAL_STORAGE_KEY = 'enx.referral'

// A stored code older than this is ignored: the claim window on the server
// is only hours after sign-up, so a week-old visit is not worth claiming.
export const REFERRAL_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Fired on window after the landing page stores a code, so an already
// signed-in visitor's claim runs right away.
export const REFERRAL_STORED_EVENT = 'enx:referral-stored'

type StoredReferral = { code: string; savedAt: number }

export function storeReferralCode(
  storage: Storage,
  code: string,
  now: number = Date.now()
): void {
  const value: StoredReferral = { code, savedAt: now }
  storage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(value))
}

// The stored code, or null when there is none, it is malformed, or it has
// expired.
export function readReferralCode(
  storage: Storage,
  now: number = Date.now()
): string | null {
  const raw = storage.getItem(REFERRAL_STORAGE_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredReferral>
    if (typeof value.code !== 'string' || typeof value.savedAt !== 'number') {
      return null
    }
    return now - value.savedAt < REFERRAL_TTL_MS ? value.code : null
  } catch {
    return null
  }
}

export function clearReferralCode(storage: Storage): void {
  storage.removeItem(REFERRAL_STORAGE_KEY)
}

// "+100 bonus credits from your invite · expires Oct 15", or null when the
// claim granted no bonus (nothing to tell the user).
export function claimToast(result: ReferralClaimData): string | null {
  if (result.bonus <= 0) return null
  const bonus = `+${result.bonus.toLocaleString('en-US')} bonus credits from your invite`
  if (result.trialExpiresAt === null) return bonus
  const date = new Date(result.trialExpiresAt * 1000).toLocaleDateString(
    'en-US',
    { month: 'short', day: 'numeric' }
  )
  return `${bonus} · expires ${date}`
}

// "300 credits · expected Oct 20": a reward waiting out the payment's
// cooling-off period.
export function pendingRewardLabel(reward: ReferralPendingReward): string {
  const date = new Date(reward.dueAt * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  return `${reward.amount.toLocaleString('en-US')} credits · expected ${date}`
}

// The landing page's pitch, from GET /api/referral/offer.
export function offerMessage(offer: ReferralOffer): string {
  if (offer.credits <= 0) return 'Join Catglish via this link.'
  return `Join via this link and get ${offer.credits.toLocaleString('en-US')} free AI credits (valid for ${offer.days} days).`
}

// Claims the stored code, if any, and clears it whatever happens. Returns
// the toast to show, or null. A refusal is only logged: the user did
// nothing wrong and can do nothing about it.
export async function claimStoredReferral(
  storage: Storage,
  claim: (code: string) => Promise<ApiResponse<ReferralClaimData>>,
  now: number = Date.now()
): Promise<string | null> {
  const code = readReferralCode(storage, now)
  clearReferralCode(storage)
  if (code === null) return null
  const resp = await claim(code)
  if (!resp.success || !resp.data) {
    console.info('Invite not claimed:', resp.error)
    return null
  }
  return claimToast(resp.data)
}
