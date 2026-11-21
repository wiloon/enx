import { createClerkClient } from '@clerk/chrome-extension/client'
import { classifyLoadedClerk } from '@/lib/auth/clerk/clerkSessionSync'
import { registerClerkSessionCookieListener } from '@/lib/auth/clerk/sessionCookie'
import { clerkSubject } from '@/lib/auth/clerk/subject'
import type { ClerkAuthConfig } from '@/lib/auth/config'
import type { WorkerAuthAdapter } from '@/lib/auth/types'

export function createClerkWorkerAuth(
  config: ClerkAuthConfig
): WorkerAuthAdapter {
  return {
    createClient: async () => {
      const client = await createClerkClient({
        publishableKey: config.publishableKey,
        syncHost: config.syncHost,
        background: true,
      })
      return {
        hasSession: () => Boolean(client.session),
        classifySession: () => classifyLoadedClerk(client),
        subject: () => clerkSubject(client),
        getToken: async ({ forceRefresh } = {}) =>
          (await client.session?.getToken(
            forceRefresh ? { skipCache: true } : undefined
          )) ?? null,
      }
    },
    registerSessionChangeListener: (cookies, onChange) =>
      registerClerkSessionCookieListener(cookies, config.syncHost, onChange),
  }
}
