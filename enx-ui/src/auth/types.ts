import type { ComponentType, ReactNode } from 'react'
import type { NextFetchEvent, NextMiddleware, NextRequest } from 'next/server'

// Produces the response for a page request once the adapter has done its own
// work, e.g. next-intl's routing for a localised page. The adapter returns
// this response, with its own headers and cookies added.
export type PageResponder = (req: NextRequest) => Response | Promise<Response>

// What a server-side auth adapter provides (ADR-036 Decision 3).
export type AuthAdapter = {
  // Wraps the app tree and fills the neutral auth context for client code.
  Provider: ComponentType<{ children: ReactNode }>
  // Handles every non-/api request in proxy.ts. Without a responder the
  // request continues to the page unchanged.
  handle: (
    req: NextRequest,
    event: NextFetchEvent,
    respond?: PageResponder
  ) => ReturnType<NextMiddleware>
  // The bodies of the dedicated sign-in and sign-up catch-all routes.
  SignInBody: ComponentType<{ forceRedirectUrl?: string }>
  SignUpBody: ComponentType
}
