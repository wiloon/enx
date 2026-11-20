import { createClerkPopupAuth } from '@/lib/auth/clerk/popupAuth'
import type { AuthConfig } from '@/lib/auth/config'
import type { PopupAuthAdapter } from '@/lib/auth/types'

/**
 * Build-time provider → popup auth adapter. The popup must go through this;
 * it never constructs a Clerk adapter directly.
 */
export function selectPopupAuth(auth: AuthConfig): PopupAuthAdapter {
  switch (auth.provider) {
    case 'clerk':
      return createClerkPopupAuth(auth)
    default: {
      const exhaustive: never = auth
      throw new Error(
        `Unsupported auth provider: ${(exhaustive as AuthConfig).provider}`
      )
    }
  }
}
