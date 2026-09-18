// Deployment-specific values the BROWSER needs.
//
// `NEXT_PUBLIC_*` would inline these at `next build`, which is exactly what
// makes an image environment-specific -- a homelab build could then never be
// promoted to production. Instead the server reads them per request and hands
// them to the client through a <script> in the root layout
// (providers/RuntimeEnvScript.tsx), so one image runs anywhere.
//
// Server-only values (CLERK_SECRET_KEY, API_BASE_URL) never belong here: read
// process.env directly in server components, middleware or next.config.

export type RuntimeEnv = {
  ENX_EXTENSION_ID: string
  ENX_EXTENSION_WEB_STORE_URL: string
}

export const RUNTIME_ENV_GLOBAL = '__ENX_ENV__'

export function serverRuntimeEnv(): RuntimeEnv {
  return {
    ENX_EXTENSION_ID: process.env.ENX_EXTENSION_ID ?? '',
    ENX_EXTENSION_WEB_STORE_URL: process.env.ENX_EXTENSION_WEB_STORE_URL ?? '',
  }
}

export function runtimeEnv(key: keyof RuntimeEnv): string {
  if (typeof window !== 'undefined') {
    const injected = (window as unknown as Record<string, RuntimeEnv | undefined>)[
      RUNTIME_ENV_GLOBAL
    ]
    return injected?.[key] ?? ''
  }
  return serverRuntimeEnv()[key]
}
