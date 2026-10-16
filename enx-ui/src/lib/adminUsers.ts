// Rules behind the admin users pages (ADR-049 Decisions 2, 3 and 11), kept
// apart from React so they run in plain unit tests.

export type Adjustment =
  { ok: true; amount: number; reason: string } | { ok: false; error: string }

// Reads the grant / deduct form: a positive whole number of credits and a
// reason, which the ledger keeps as the note (enx-api rejects a blank one).
export function parseAdjustment(amount: string, reason: string): Adjustment {
  const trimmed = amount.trim()
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
    return { ok: false, error: 'Enter a whole number of credits above zero.' }
  }
  if (reason.trim() === '') {
    return { ok: false, error: 'A reason is required.' }
  }
  return { ok: true, amount: Number(trimmed), reason: reason.trim() }
}

// The UTC calendar day of an RFC 3339 time from enx-api, or a dash when
// there is none (a user who never signed in again).
export function utcDate(at: string | null): string {
  return at ? at.slice(0, 10) : '—'
}

// "2026-10-05 10:07 UTC" for a ledger row. enx-api always sends UTC (Z).
export function utcMinute(at: string): string {
  return `${at.slice(0, 10)} ${at.slice(11, 16)} UTC`
}

// A ledger amount with its sign: +25 for a grant, -90 for a clawback.
export function signedCredits(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

const LEDGER_LABELS: Record<string, string> = {
  GRANT_SUBSCRIPTION: 'Subscription credits',
  GRANT_TOPUP: 'Top-up purchase',
  GRANT_TRIAL: 'Sign-up trial',
  GRANT_ADMIN: 'Admin grant',
  DEDUCT_ADMIN: 'Admin deduction',
  CLAWBACK: 'Refund clawback',
  SETTLE: 'AI usage',
  // Older AI spend rows; nothing writes these any more.
  CONSUME: 'AI usage',
  REFUND: 'AI usage refund',
}

// The name a credit_transactions type goes by on the timeline. A type this
// page does not know yet (a new grant kind) shows as it is.
export function ledgerEntryLabel(type: string): string {
  return LEDGER_LABELS[type] ?? type
}

// A deduction comes out of the top-up pool only, which may go negative
// (ADR-049 Decision 3). Returns the warning to show before confirming, or
// null when the pool covers it.
export function deductWarning(
  topupBalance: number,
  amount: number
): string | null {
  const after = topupBalance - amount
  if (after >= 0) return null
  return `This leaves the top-up balance at ${after} credits.`
}
