// Account deletion, disabled accounts (ADR-062) and accounts without an
// email (ADR-015).

// enx-api's 403 for an account the admin disabled (ADR-062 Decision 5).
export const ACCOUNT_DISABLED_CODE = 'account_disabled'
export const ACCOUNT_DISABLED_MESSAGE = 'This account has been disabled.'

// enx-api's 403 for a new user whose Clerk session token carries no email
// (ADR-015, 2026-10-20 note §3): the same 403-with-a-code shape as
// account_disabled. Only support can add the email, so there is nothing to
// retry and no state to latch -- just a clearer message.
export const EMAIL_REQUIRED_CODE = 'email_required'
export const EMAIL_REQUIRED_MESSAGE =
  'Your account has no email address. Contact support to add one.'

// Whether an enx-api error response says the account is disabled. Other
// 403s (e.g. "admin access required") are not.
export function isAccountDisabled(
  status: number,
  body: { code?: unknown; [key: string]: unknown } | null | undefined
): boolean {
  return status === 403 && body?.code === ACCOUNT_DISABLED_CODE
}

// Whether an enx-api error response says the account has no email address.
// Other 403s, including account_disabled, are not.
export function isEmailRequired(
  status: number,
  body: { code?: unknown; [key: string]: unknown } | null | undefined
): boolean {
  return status === 403 && body?.code === EMAIL_REQUIRED_CODE
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

// Whether the email typed to confirm a deletion is the account's own, the
// same comparison enx-api makes (case and surrounding spaces aside).
export function emailMatches(typed: string, accountEmail: string): boolean {
  const t = normalizeEmail(typed)
  return t !== '' && t === normalizeEmail(accountEmail)
}

export type AdminUserAction = 'disable' | 'enable' | 'revoke-sessions'
