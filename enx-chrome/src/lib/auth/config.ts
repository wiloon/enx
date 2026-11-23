// Auth config shape shared by targets.ts (Vite/Node) and the runtime adapter.
// Keep this file free of React, path aliases, and other runtime imports so
// vite.config.ts can load it through targets.ts.

export type AuthProviderId = 'clerk'

export interface ClerkAuthConfig {
  provider: 'clerk'
  /** Clerk publishable key (not secret). */
  publishableKey: string
  /**
   * Origin whose session cookie the extension mirrors. Not where the sign-in
   * tab goes — that is frontendBaseUrl (ADR-020).
   */
  syncHost: string
}

export type AuthConfig = ClerkAuthConfig
