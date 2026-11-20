import { createClerkClient } from '@clerk/chrome-extension/client'
import {
  classifyLoadedClerk,
  type LoadedClerk,
} from '@/lib/auth/clerk/clerkSessionSync'
import { registerClerkSessionCookieListener } from '@/lib/auth/clerk/sessionCookie'
import { clerkSubject } from '@/lib/auth/clerk/subject'
import type { ClerkAuthConfig } from '@/lib/auth/config'
import type { AuthClient, WorkerAuthAdapter } from '@/lib/auth/types'

type CreateClerkClient = typeof createClerkClient

export function createClerkWorkerAuth(
  config: ClerkAuthConfig,
  deps: { createClerkClient?: CreateClerkClient } = {}
): WorkerAuthAdapter {
  const create = deps.createClerkClient ?? createClerkClient

  return {
    createClient: async () => {
      const client = await create({
        publishableKey: config.publishableKey,
        syncHost: config.syncHost,
        background: true,
      })
      return client as AuthClient
    },
    classifyLoaded: client =>
      classifyLoadedClerk(client as unknown as LoadedClerk),
    subject: clerkSubject,
    registerSessionChangeListener: (cookies, onChange) =>
      registerClerkSessionCookieListener(cookies, config.syncHost, onChange),
  }
}
