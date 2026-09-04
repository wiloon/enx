import { clerkMiddleware } from '@clerk/nextjs/server'

// ADR-015: Clerk replaces Cognito. No routes are protected server-side — the app
// (/app, /lookup, /rephrase, /billing) gates on the client via <AuthWrapper> /
// useAuth, and the marketing pages are public. clerkMiddleware() is still
// required for <ClerkProvider> and the Clerk hooks to work.
export default clerkMiddleware()

export const config = {
  matcher: [
    // Skip Next internals and static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
