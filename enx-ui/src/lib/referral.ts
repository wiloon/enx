import type {
  ApiResponse,
  ReferralClaimData,
  ReferralOffer,
  ReferralPendingReward,
} from '@/types'

// Invite links (ADR-051 Decision 2): the /invite/<code> landing page keeps
// the code in localStorage until the visitor is signed in, then the app
// claims it and forgets it once the server has given a final answer.

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
  const value = readStoredReferral(storage)
  if (value === null) return null
  return now - value.savedAt < REFERRAL_TTL_MS ? value.code : null
}

function readStoredReferral(storage: Storage): StoredReferral | null {
  const raw = storage.getItem(REFERRAL_STORAGE_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredReferral>
    if (typeof value.code !== 'string' || typeof value.savedAt !== 'number') {
      return null
    }
    return { code: value.code, savedAt: value.savedAt }
  } catch {
    return null
  }
}

export function clearReferralCode(storage: Storage): void {
  storage.removeItem(REFERRAL_STORAGE_KEY)
}

// Clears the stored code only if it is still `code`: another invite link
// opened meanwhile has replaced it, and that newer code must survive.
// Expiry plays no part; the same code stored again is still cleared.
function clearReferralCodeIf(storage: Storage, code: string): void {
  if (readStoredReferral(storage)?.code === code) {
    clearReferralCode(storage)
  }
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

// 4xx answers given before the claim ran: no session, or the request rate
// limit (ADR-060). A later try can still succeed.
const CLAIM_NOT_RUN = new Set([401, 429])

// Whether a claim answer is final: it succeeded, or the server refused it
// with a 4xx that a retry cannot change. A 5xx, a CLAIM_NOT_RUN status or
// no answer at all is not.
function claimSettled(resp: ApiResponse<ReferralClaimData>): boolean {
  if (resp.success) return true
  const { status } = resp
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    !CLAIM_NOT_RUN.has(status)
  )
}

// Claims the stored code, if any, and clears it once the answer is final,
// unless a newer code has replaced it during the claim; otherwise the code
// stays for the next page load or sign-in to retry,
// bounded by REFERRAL_TTL_MS and the server's claim window. Returns the
// toast to show, or null. A refusal is only logged: the user did nothing
// wrong and can do nothing about it.
export async function claimStoredReferral(
  storage: Storage,
  claim: (code: string) => Promise<ApiResponse<ReferralClaimData>>,
  now: number = Date.now()
): Promise<string | null> {
  const code = readReferralCode(storage, now)
  if (code === null) {
    clearReferralCode(storage)
    return null
  }
  const resp = await claim(code)
  if (claimSettled(resp)) {
    clearReferralCodeIf(storage, code)
  }
  if (!resp.success || !resp.data) {
    console.info('Invite not claimed:', resp.error)
    return null
  }
  return claimToast(resp.data)
}

// What a claim attempt runs against: the storage holding the code, the API
// call, and where a bonus toast goes.
export type ReferralClaimContext = {
  storage: Storage
  claim: (code: string) => Promise<ApiResponse<ReferralClaimData>>
  onBonus: (toast: string) => void
}

export type ReferralClaimRunner = {
  trigger: () => void
  setContext: (context: ReferralClaimContext | null) => void
}

// Runs claimStoredReferral at most one at a time. A trigger during a claim
// is not dropped: all triggers received during one attempt make a single
// follow-up attempt once it settles, which reads whatever code is stored by
// then. Each attempt uses the context set when it starts; the context is
// null while the claimer is unmounted or signed out, so no follow-up runs
// then and the next trigger reads storage as usual. Settling alone never
// schedules a retry.
export function createReferralClaimRunner(): ReferralClaimRunner {
  let current: ReferralClaimContext | null = null
  let running = false
  let pending = false

  const run = async (context: ReferralClaimContext) => {
    running = true
    try {
      const toast = await claimStoredReferral(context.storage, context.claim)
      if (toast) context.onBonus(toast)
    } catch (err) {
      console.error('Invite claim failed:', err)
    } finally {
      running = false
    }
    if (pending) {
      pending = false
      trigger()
    }
  }

  const trigger = () => {
    if (running) {
      pending = true
      return
    }
    if (current !== null) void run(current)
  }

  const setContext = (context: ReferralClaimContext | null) => {
    current = context
  }

  return { trigger, setContext }
}
