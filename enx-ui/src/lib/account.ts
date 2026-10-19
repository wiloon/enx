// Account deletion and disabled accounts (ADR-062).

// enx-api's 403 for an account the admin disabled (ADR-062 Decision 5).
export const ACCOUNT_DISABLED_CODE = 'account_disabled'
export const ACCOUNT_DISABLED_MESSAGE = 'This account has been disabled.'

// Whether an enx-api error response says the account is disabled. Other
// 403s (e.g. "admin access required") are not.
export function isAccountDisabled(
  status: number,
  body: { code?: unknown; [key: string]: unknown } | null | undefined
): boolean {
  return status === 403 && body?.code === ACCOUNT_DISABLED_CODE
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

// Whether the email typed to confirm a deletion is the account's own, the
// same comparison enx-api makes (case and surrounding spaces aside).
export function emailMatches(typed: string, accountEmail: string): boolean {
  const t = normalizeEmail(typed)
  return t !== '' && t === normalizeEmail(accountEmail)
}

export type AdminUserAction = 'disable' | 'enable' | 'revoke-sessions'
