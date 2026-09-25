import { clerkMiddleware } from '@clerk/nextjs/server'
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from 'next/server'
import { apiProxyUrl, isApiPath } from '@/lib/apiProxy'

// `/api/*` is relayed to the API named by API_BASE_URL, read on every request
// (see lib/apiProxy.ts for why this cannot be next.config.ts `rewrites()`).
// The API authenticates the Bearer token itself, so Clerk is not involved.
function relayToApi(req: NextRequest): NextResponse {
  const target = apiProxyUrl(
    req.nextUrl.pathname,
    req.nextUrl.search,
    process.env.API_BASE_URL
  )
  if (!target) {
    console.error('API_BASE_URL is not set; cannot relay', req.nextUrl.pathname)
    return NextResponse.json(
      { error: 'API_BASE_URL is not configured on this server' },
      { status: 500 }
    )
  }
  return NextResponse.rewrite(target)
}

// ADR-015: Clerk replaces Cognito. No routes are protected server-side — the app
// (/app, /lookup, /rephrase, /billing) gates on the client via <AuthWrapper> /
// useAuth, and the marketing pages are public. clerkMiddleware() is still
// required for <ClerkProvider> and the Clerk hooks to work.
//
// The key is passed explicitly because it is a runtime value (see
// lib/runtimeEnv.ts): without it Clerk falls back to the build-time-inlined
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, which the image no longer has, and every
// request dies with "Missing publishableKey".
const clerk = clerkMiddleware({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
})

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (isApiPath(req.nextUrl.pathname)) return relayToApi(req)
  return clerk(req, event)
}

export const config = {
  matcher: [
    // Skip Next internals and static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
