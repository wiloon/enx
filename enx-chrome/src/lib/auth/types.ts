// Auth adapter types for enx-chrome (ADR-036 Decision 3).

import type { ReactElement, ReactNode } from 'react'
import type { AuthConfig, AuthProviderId } from '@/lib/auth/config'
import type { SessionSync } from '@/lib/sessionSync'

export type { AuthConfig, AuthProviderId }

/** Stable account subject used for per-account local storage keys. */
export type AuthSubject = string

export interface AuthUser {
  id: AuthSubject
  fullName: string | null
  username: string | null
  primaryEmail: string | null
}

export interface AuthSessionView {
  isLoaded: boolean
  isSignedIn: boolean
  user: AuthUser | null
  sessionId: string | null
}

/**
 * Opaque session client the worker holds. Callers use adapter methods; they
 * never import the IdP SDK.
 */
export type AuthClient = {
  session: {
    getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>
  } | null
  user: { id: string } | null
}

export type SessionCookieChangeInfo = {
  removed: boolean
  cause?: string
  cookie: {
    domain: string
    path?: string
    name: string
    value?: string
  }
}

export interface WorkerAuthAdapter {
  createClient: () => Promise<AuthClient>
  classifyLoaded: (client: AuthClient) => Promise<SessionSync>
  subject: (client: AuthClient) => AuthSubject | null
  /**
   * Register the provider's session-change listener synchronously (MV3: a
   * cookie change must wake an evicted worker). The handler runs only for
   * matching session cookies.
   */
  registerSessionChangeListener: (
    cookies: {
      onChanged: {
        addListener: (
          listener: (
            change: SessionCookieChangeInfo
          ) => void | Promise<void>
        ) => void
      }
    },
    syncHost: string,
    onChange: (
      change: SessionCookieChangeInfo
    ) => void | Promise<void>
  ) => void
}

export interface PopupAuthAdapter {
  Provider: (props: { children: ReactNode }) => ReactElement
}
