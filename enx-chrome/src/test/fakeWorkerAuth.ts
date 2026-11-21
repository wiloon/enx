import { registerClerkSessionCookieListener } from '@/lib/auth/clerk/sessionCookie'
import type {
  AuthClient,
  AuthConfig,
  WorkerAuthAdapter,
} from '@/lib/auth/types'

export function fakeSession(
  subject: string | null,
  getToken: AuthClient['getToken'] = async () => null
): AuthClient {
  return {
    hasSession: () => true,
    classifySession: async () => 'present',
    subject: () => subject,
    getToken,
  }
}

export const createClient = jest.fn<Promise<AuthClient>, []>()

export const selectWorkerAuth = jest.fn(
  (config: AuthConfig): WorkerAuthAdapter => ({
    createClient: () => createClient(),
    // Exercise the real cookie filtering in the worker's cookie-change tests.
    registerSessionChangeListener: (cookies, onChange) =>
      registerClerkSessionCookieListener(cookies, config.syncHost, onChange),
  })
)
