import { ClerkProvider, SignIn, SignUp } from '@clerk/nextjs'
import { clerkMiddleware } from '@clerk/nextjs/server'
import type { NextFetchEvent, NextMiddleware, NextRequest } from 'next/server'
import type { AuthAdapter } from '../types'
import ClerkAuthContext from './ClerkAuthContext'

// The publishable key is a runtime value (see lib/runtimeEnv.ts): without it
// Clerk falls back to the build-time-inlined NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
// which the image no longer has, and every request dies with "Missing
// publishableKey".
let handler: NextMiddleware | undefined

// ADR-015: no routes are protected server-side. clerkMiddleware() is still
// required for <ClerkProvider> and the Clerk hooks to work.
function handle(req: NextRequest, event: NextFetchEvent) {
  handler ??= clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  })
  return handler(req, event)
}

export const clerkAdapter: AuthAdapter = {
  Provider: ({ children }) => (
    <ClerkProvider publishableKey={process.env.CLERK_PUBLISHABLE_KEY}>
      <ClerkAuthContext>{children}</ClerkAuthContext>
    </ClerkProvider>
  ),
  handle,
  SignInBody: ({ forceRedirectUrl }) => (
    <SignIn forceRedirectUrl={forceRedirectUrl} />
  ),
  SignUpBody: () => <SignUp />,
}
