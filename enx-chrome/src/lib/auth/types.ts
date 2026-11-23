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

/** A loaded provider session exposed to the worker. */
export interface AuthClient {
  hasSession: () => boolean
  classifySession: () => Promise<SessionSync>
  subject: () => AuthSubject | null
  getToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>
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
    onChange: (
      change: SessionCookieChangeInfo
    ) => void | Promise<void>
  ) => void
}

export interface PopupAuthAdapter {
  Provider: (props: { children: ReactNode }) => ReactElement
}
