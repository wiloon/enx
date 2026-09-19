// Single source of truth for every deployment-specific URL in the extension.
//
// Imported twice, on purpose:
//   - build time  : vite.config.ts picks a target from the Vite mode / VITE_ENV
//                   and stamps it into the generated manifest (see manifest.ts)
//   - run time    : src/config/env.ts re-reads the values Vite injected
//
// Keep this file free of `import.meta` / `process` so it stays loadable from
// the Vite config (Node) and from Jest (CommonJS) as well as the browser.

export type TargetName = 'development' | 'homelab' | 'production' | 'test'

export interface Target {
  name: TargetName
  apiBaseUrl: string
  frontendBaseUrl: string
  clerkPublishableKey: string
  /**
   * Origin whose Clerk session the extension mirrors (@clerk/chrome-extension
   * ClerkProvider `syncHost`).
   */
  clerkSyncHost: string
  /**
   * enx-ui origins that get the content script AND the externally_connectable
   * channel (ADR-019). Kept in one list so the two can't drift apart.
   */
  uiOrigins: string[]
}

// Clerk *development* instance (rational-deer-4450). A production build should
// override it with VITE_CLERK_PUBLISHABLE_KEY once a prod instance exists.
export const DEV_CLERK_PUBLISHABLE_KEY =
  'pk_test_cmF0aW9uYWwtZGVlci00NDUwLmNsZXJrLmFjY291bnRzLmRldiQ'

const LOCAL_UI_ORIGIN = 'http://localhost:3000'

export const TARGETS: Record<TargetName, Target> = {
  development: {
    name: 'development',
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: LOCAL_UI_ORIGIN,
    clerkPublishableKey: DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost: LOCAL_UI_ORIGIN,
    uiOrigins: [LOCAL_UI_ORIGIN],
  },
  homelab: {
    name: 'homelab',
    apiBaseUrl: 'https://enx-api.wiloon.lab',
    frontendBaseUrl: 'https://enx.wiloon.lab',
    clerkPublishableKey: DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost: 'https://enx.wiloon.lab',
    // The homelab build doubles as the day-to-day dev build, so it keeps the
    // localhost origin; the production build deliberately does not.
    uiOrigins: [LOCAL_UI_ORIGIN, 'https://enx.wiloon.lab'],
  },
  production: {
    name: 'production',
    // Catglish production (ADR-031): catglish.com serves enx-ui, api.catglish.com
    // serves enx-api. The Clerk publishable key comes from .env.production
    // (VITE_CLERK_PUBLISHABLE_KEY, a pk_live_ key for clerk.catglish.com); the
    // dev key below is only a fallback so a bare `--mode production` build still
    // boots -- it must never ship, which .env.production prevents.
    apiBaseUrl: 'https://api.catglish.com',
    frontendBaseUrl: 'https://catglish.com',
    clerkPublishableKey: DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost: 'https://catglish.com',
    uiOrigins: ['https://catglish.com'],
  },
  test: {
    name: 'test',
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: LOCAL_UI_ORIGIN,
    clerkPublishableKey: DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost: LOCAL_UI_ORIGIN,
    uiOrigins: [LOCAL_UI_ORIGIN],
  },
}

export const DEFAULT_TARGET: TargetName = 'homelab'

const ALIASES: Record<string, TargetName> = {
  dev: 'development',
  development: 'development',
  lab: 'homelab',
  homelab: 'homelab',
  // `staging` was the old name of the homelab target.
  staging: 'homelab',
  prod: 'production',
  production: 'production',
  test: 'test',
}

/** Maps a Vite mode / VITE_ENV value onto a target, or undefined if unknown. */
export function resolveTargetName(
  value?: string | null
): TargetName | undefined {
  return value ? ALIASES[value.trim().toLowerCase()] : undefined
}

/**
 * Per-URL escape hatch: any target value can be overridden without editing this
 * file, e.g. `VITE_API_BASE_URL=http://192.168.50.71:8090 task build`.
 */
export function applyOverrides(
  target: Target,
  env: Record<string, string | undefined>
): Target {
  const uiOrigins = env.VITE_ENX_UI_ORIGINS
    ? env.VITE_ENX_UI_ORIGINS.split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
    : target.uiOrigins

  return {
    ...target,
    apiBaseUrl: env.VITE_API_BASE_URL || target.apiBaseUrl,
    frontendBaseUrl: env.VITE_FRONTEND_BASE_URL || target.frontendBaseUrl,
    clerkPublishableKey:
      env.VITE_CLERK_PUBLISHABLE_KEY || target.clerkPublishableKey,
    clerkSyncHost: env.VITE_CLERK_SYNC_HOST || target.clerkSyncHost,
    uiOrigins,
  }
}

/**
 * Clerk's Frontend API host is base64-encoded inside the publishable key, so the
 * matching host permission follows the key instead of being hardcoded.
 */
export function clerkFrontendApiHost(publishableKey: string): string | null {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, '')
  try {
    const decoded = atob(encoded).replace(/\$$/, '')
    return /^[a-z0-9.-]+$/i.test(decoded) ? decoded : null
  } catch {
    return null
  }
}
