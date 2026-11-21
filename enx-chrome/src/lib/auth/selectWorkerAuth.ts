import { createClerkWorkerAuth } from '@/lib/auth/clerk/workerAuth'
import type { AuthConfig } from '@/lib/auth/config'
import type { WorkerAuthAdapter } from '@/lib/auth/types'

/**
 * Build-time provider → worker auth adapter. The worker must go through this;
 * it never constructs a Clerk adapter directly.
 */
export function selectWorkerAuth(auth: AuthConfig): WorkerAuthAdapter {
  if (auth.provider === 'clerk') {
    return createClerkWorkerAuth(auth)
  }
  throw new Error(
    `Unsupported auth provider: ${(auth as { provider: string }).provider}`
  )
}
