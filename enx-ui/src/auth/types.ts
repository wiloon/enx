import type { ComponentType, ReactNode } from 'react'
import type { NextMiddleware } from 'next/server'

// What a server-side auth adapter provides (ADR-036 Decision 3).
export type AuthAdapter = {
  // Wraps the app tree and fills the neutral auth context for client code.
  Provider: ComponentType<{ children: ReactNode }>
  // Handles every non-/api request in proxy.ts.
  handle: NextMiddleware
  // The bodies of the dedicated sign-in and sign-up catch-all routes.
  SignInBody: ComponentType<{ forceRedirectUrl?: string }>
  SignUpBody: ComponentType
}
