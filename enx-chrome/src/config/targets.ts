// Single source of truth for every deployment-specific URL in the extension.
//
// Build time only: vite.config.ts picks a target from the Vite mode / VITE_ENV
// (resolveBuildTarget), stamps it into the generated manifest (manifest.ts) and
// into the bundle (stampedEnv -> `define`). At run time src/config/env.ts reads
// the stamped values back and never indexes TARGETS, so a bundle carries only
// its own target. Runtime code must not import TARGETS.
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
   * ClerkProvider `syncHost`): the website for a development instance (the
   * `__clerk_db_jwt` cookie lives there), the Clerk Frontend API host for a
   * production instance (`__client` lives there). Not where the sign-in tab
   * goes -- that is frontendBaseUrl.
   */
  clerkSyncHost: string
  /**
   * enx-ui origins that get the content script AND the externally_connectable
   * channel (ADR-019). Kept in one list so the two can't drift apart.
   */
  uiOrigins: string[]
  /**
   * RSSX Reader origins (ADR-033): they get the content script and the RSSX
   * site adapter, but no host permission or external messaging. The reader
   * lives on a LAN host, so only the homelab and dev builds list it; the store
   * build stays off private domains.
   */
  rssxOrigins: string[]
  /**
   * Generic sites that get the content script (and a host permission) in this
   * build only. They stay ordinary sites: no Reader or RSSX adapter, no
   * enx-ui stamps. Empty in every declared target; the E2E build fills it
   * through VITE_CONTENT_SCRIPT_ORIGINS (ADR-037).
   */
  contentScriptOrigins: string[]
}

const RSSX_LAB_ORIGIN = 'https://rssx-lab.wiloon.com'

// Clerk *development* instance (rational-deer-4450). A production build should
// override it with VITE_CLERK_PUBLISHABLE_KEY once a prod instance exists.
export const DEV_CLERK_PUBLISHABLE_KEY =
  'pk_test_cmF0aW9uYWwtZGVlci00NDUwLmNsZXJrLmFjY291bnRzLmRldiQ'

const LOCAL_UI_ORIGIN = 'http://localhost:3000'

export const TARGETS: Record<TargetName, Target> = {
  development: {
    name: 'development',
    // enx-api's dev server (`port` in enx-api/config.toml).
    apiBaseUrl: 'http://localhost:8091',
    frontendBaseUrl: LOCAL_UI_ORIGIN,
    clerkPublishableKey: DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost: LOCAL_UI_ORIGIN,
    uiOrigins: [LOCAL_UI_ORIGIN],
    rssxOrigins: [RSSX_LAB_ORIGIN],
    contentScriptOrigins: [],
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
    rssxOrigins: [RSSX_LAB_ORIGIN],
    contentScriptOrigins: [],
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
    // Not the website: a production Clerk instance sets the `__client` cookie
    // on its Frontend API host (Domain=clerk.catglish.com), and
    // @clerk/chrome-extension reads that cookie at syncHost. With
    // https://catglish.com here the extension never sees the session.
    clerkSyncHost: 'https://clerk.catglish.com',
    uiOrigins: ['https://catglish.com'],
    rssxOrigins: [],
    contentScriptOrigins: [],
  },
  test: {
    name: 'test',
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: LOCAL_UI_ORIGIN,
    clerkPublishableKey: DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost: LOCAL_UI_ORIGIN,
    uiOrigins: [LOCAL_UI_ORIGIN],
    rssxOrigins: [],
    contentScriptOrigins: [],
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
  return {
    ...target,
    apiBaseUrl: env.VITE_API_BASE_URL || target.apiBaseUrl,
    frontendBaseUrl: env.VITE_FRONTEND_BASE_URL || target.frontendBaseUrl,
    clerkPublishableKey:
      env.VITE_CLERK_PUBLISHABLE_KEY || target.clerkPublishableKey,
    clerkSyncHost: env.VITE_CLERK_SYNC_HOST || target.clerkSyncHost,
    uiOrigins: originList(env.VITE_ENX_UI_ORIGINS) ?? target.uiOrigins,
    contentScriptOrigins:
      originList(env.VITE_CONTENT_SCRIPT_ORIGINS) ??
      target.contentScriptOrigins,
  }
}

// A comma-separated override, or undefined when unset or empty.
function originList(value: string | undefined): string[] | undefined {
  return value
    ? value
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
    : undefined
}

/**
 * The target a build is stamped with: VITE_ENV, else the Vite mode, picks the
 * entry (homelab if neither is known), then the per-URL overrides apply.
 */
export function resolveBuildTarget(
  mode: string,
  env: Record<string, string | undefined>
): Target {
  const name =
    resolveTargetName(env.VITE_ENV) ?? resolveTargetName(mode) ?? DEFAULT_TARGET
  return applyOverrides(TARGETS[name], env)
}

/**
 * The build env keys a target is stamped into (vite.config.ts `define`), which
 * src/config/env.ts reads back at run time.
 */
export function stampedEnv(target: Target): Record<string, string> {
  return {
    VITE_ENV: target.name,
    VITE_API_BASE_URL: target.apiBaseUrl,
    VITE_FRONTEND_BASE_URL: target.frontendBaseUrl,
    VITE_CLERK_PUBLISHABLE_KEY: target.clerkPublishableKey,
    VITE_CLERK_SYNC_HOST: target.clerkSyncHost,
    VITE_ENX_UI_ORIGINS: target.uiOrigins.join(','),
    VITE_RSSX_ORIGINS: target.rssxOrigins.join(','),
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
