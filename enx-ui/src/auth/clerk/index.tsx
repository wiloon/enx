import { ClerkProvider } from '@clerk/nextjs'
import { clerkMiddleware } from '@clerk/nextjs/server'
import type { NextFetchEvent, NextMiddleware, NextRequest } from 'next/server'
import type { AuthAdapter, PageResponder } from '../types'
import ClerkAuthContext from './ClerkAuthContext'
import { SignInBody, SignUpBody } from './ClerkAuthWidgets'

// The publishable key is a runtime value (see lib/runtimeEnv.ts): without it
// Clerk falls back to the build-time-inlined NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
// which the image no longer has, and every request dies with "Missing
// publishableKey".
let handler: NextMiddleware | undefined

// The page responder of each request in flight. Clerk passes the same
// request object on to its handler, which returns the responder's response
// (e.g. next-intl's rewrite or redirect) for Clerk to add its headers to.
const responders = new WeakMap<NextRequest, PageResponder>()

// ADR-015: no routes are protected server-side. clerkMiddleware() is still
// required for <ClerkProvider> and the Clerk hooks to work.
function handle(
  req: NextRequest,
  event: NextFetchEvent,
  respond?: PageResponder
) {
  handler ??= clerkMiddleware(
    (_auth, request) => responders.get(request)?.(request),
    { publishableKey: process.env.CLERK_PUBLISHABLE_KEY }
  )
  if (respond) responders.set(req, respond)
  return handler(req, event)
}

export const clerkAdapter: AuthAdapter = {
  Provider: ({ children }) => (
    <ClerkProvider publishableKey={process.env.CLERK_PUBLISHABLE_KEY}>
      <ClerkAuthContext>{children}</ClerkAuthContext>
    </ClerkProvider>
  ),
  handle,
  SignInBody,
  SignUpBody,
}
