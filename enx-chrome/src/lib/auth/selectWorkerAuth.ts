import { createClerkWorkerAuth } from '@/lib/auth/clerk/workerAuth'
import type { AuthConfig } from '@/lib/auth/config'
import type { WorkerAuthAdapter } from '@/lib/auth/types'

/**
 * Build-time provider → worker auth adapter. The worker must go through this;
 * it never constructs a Clerk adapter directly.
 */
export function selectWorkerAuth(auth: AuthConfig): WorkerAuthAdapter {
  switch (auth.provider) {
    case 'clerk':
      return createClerkWorkerAuth(auth)
    default: {
      const exhaustive: never = auth
      throw new Error(
        `Unsupported auth provider: ${(exhaustive as AuthConfig).provider}`
      )
    }
  }
}
