// enx-api answers 403 with this code for an account the admin disabled
// (ADR-062 Decision 5). It stays disabled until an admin enables it, so
// nothing retries it; the reader sees the same message as in enx-ui.

import type { HttpFailure } from '@/lib/rateLimit'

export const ACCOUNT_DISABLED_CODE = 'account_disabled'
export const ACCOUNT_DISABLED_MESSAGE = 'This account has been disabled.'

/** enx-api refused the request because the account is disabled. Other 403s
 *  (e.g. "admin access required") are not. */
export const isAccountDisabled = (r: HttpFailure): boolean =>
  r.status === 403 && r.code === ACCOUNT_DISABLED_CODE
