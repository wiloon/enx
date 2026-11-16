// enx-api answers 403 with these codes for an account it will not serve:
// `account_disabled` for an account the admin disabled (ADR-062 Decision 5),
// and `email_required` for a new user whose Clerk token carries no email
// (ADR-015 2026-10-20 note §3). Neither clears by retrying; the reader sees
// the same message as in enx-ui.

import type { HttpFailure } from '@/lib/rateLimit'

export const ACCOUNT_DISABLED_CODE = 'account_disabled'
export const ACCOUNT_DISABLED_MESSAGE = 'This account has been disabled.'

export const EMAIL_REQUIRED_CODE = 'email_required'
export const EMAIL_REQUIRED_MESSAGE =
  'Your account has no email address. Contact support to add one.'

/** enx-api refused the request because the account is disabled. Other 403s
 *  (e.g. "admin access required") are not. */
export const isAccountDisabled = (r: HttpFailure): boolean =>
  r.status === 403 && r.code === ACCOUNT_DISABLED_CODE

/** enx-api refused the request because the account has no email address.
 *  Other 403s, including `account_disabled`, are not. */
export const isEmailRequired = (r: HttpFailure): boolean =>
  r.status === 403 && r.code === EMAIL_REQUIRED_CODE
