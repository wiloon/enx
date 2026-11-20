// Barrel for shared auth types and React session hooks.
// Worker and popup entry points import their selectors from
// selectWorkerAuth.ts / selectPopupAuth.ts so the worker never loads the
// React Clerk package (and Jest can keep mocking only /client).

export type { AuthConfig, AuthProviderId, ClerkAuthConfig } from '@/lib/auth/config'
export type {
  AuthClient,
  AuthSessionView,
  AuthSubject,
  AuthUser,
  PopupAuthAdapter,
  SessionCookieChangeInfo,
  WorkerAuthAdapter,
} from '@/lib/auth/types'
export { useAuthSession, useAuthSignOut } from '@/lib/auth/context'
