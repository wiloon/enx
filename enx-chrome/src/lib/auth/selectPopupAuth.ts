import { createClerkPopupAuth } from '@/lib/auth/clerk/popupAuth'
import type { AuthConfig } from '@/lib/auth/config'
import type { PopupAuthAdapter } from '@/lib/auth/types'

/**
 * Build-time provider → popup auth adapter. The popup must go through this;
 * it never constructs a Clerk adapter directly.
 */
export function selectPopupAuth(auth: AuthConfig): PopupAuthAdapter {
  if (auth.provider === 'clerk') {
    return createClerkPopupAuth(auth)
  }
  throw new Error(
    `Unsupported auth provider: ${(auth as { provider: string }).provider}`
  )
}
