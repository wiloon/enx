import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from 'next/server'
import createMiddleware from 'next-intl/middleware'
import { getAuthAdapter } from '@/auth'
import { routing } from '@/i18n/routing'
import { apiProxyUrl, isApiPath } from '@/lib/apiProxy'
import { isLocalisedPath } from '@/lib/uiLanguage'

// `/api/*` is relayed to the API named by API_BASE_URL, read on every request
// (see lib/apiProxy.ts for why this cannot be next.config.ts `rewrites()`).
// The API authenticates the Bearer token itself, so the auth adapter is not
// involved.
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

const handleI18nRouting = createMiddleware(routing)

// Every other request goes to the auth adapter selected by AUTH_PROVIDER
// (ADR-036 Decision 3). No routes are protected server-side: the app layout
// gates signed-out visitors and enx-api verifies bearer tokens. A localised
// public page (lib/uiLanguage.ts) goes through next-intl's routing first,
// which the adapter runs and returns (ADR-096 Decision 6); any other page
// reaches the adapter alone, as before.
//
// Next 16 renamed middleware.ts to proxy.ts (same role, Node.js runtime).
export default function proxy(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl
  if (isApiPath(pathname)) return relayToApi(req)
  if (isLocalisedPath(pathname)) {
    return getAuthAdapter().handle(req, event, handleI18nRouting)
  }
  return getAuthAdapter().handle(req, event)
}

export const config = {
  matcher: [
    // Skip Next internals and static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
