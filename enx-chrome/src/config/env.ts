// Environment configuration for ENX Chrome Extension
//
// The URLs themselves live in targets.ts. vite.config.ts resolves the build's
// target (`vite build --mode homelab|production`, plus VITE_* overrides) and
// stamps only that one into the bundle; this module reads the stamped values.
// It must not import TARGETS, or every target ships in every build (#231).

import { parseHanCharLimit } from '@/lib/articleLanguage'
import { readBuildEnv, type BuildEnvKey } from './buildEnv'
import { resolveTargetName, type TargetName } from './targets'

export interface EnvConfig {
  apiBaseUrl: string
  frontendBaseUrl: string
  // Clerk (ADR-015). Publishable key is not secret; syncHost is the website
  // origin whose Clerk session the extension mirrors (@clerk/chrome-extension
  // ClerkProvider `syncHost`) so "logged in on the site -> logged in in the
  // extension" works without a second sign-in.
  clerkPublishableKey: string
  clerkSyncHost: string
  // enx-ui origins: the web -> extension channel (ADR-019), the Reader
  // adapter and the data-enx-* stamps.
  uiOrigins: string[]
  // RSSX Reader origins (ADR-033) that get the RSSX site adapter.
  rssxOrigins: string[]
  // An article body with more Chinese characters than this is not processed.
  hanCharLimit: number
  environment: TargetName
  // Stamped by vite.config.ts for the popup footer; absent under Jest.
  buildCommit?: string
  /** ISO 8601 */
  builtAt?: string
}

// A value vite.config.ts always stamps; missing means a broken build setup.
const stamped = (key: BuildEnvKey): string => {
  const value = readBuildEnv(key)
  if (value === undefined) {
    throw new Error(`[ENX Config] ${key} was not stamped by vite.config.ts`)
  }
  return value
}

const environment = resolveTargetName(stamped('VITE_ENV'))
if (!environment) {
  throw new Error(`[ENX Config] Unknown VITE_ENV value: ${stamped('VITE_ENV')}`)
}

// The API server is fixed per build: there is no runtime override (a stale
// `apiBaseUrl` key in chrome.storage.local is simply not read).
export const config: EnvConfig = {
  apiBaseUrl: stamped('VITE_API_BASE_URL'),
  frontendBaseUrl: stamped('VITE_FRONTEND_BASE_URL'),
  clerkPublishableKey: stamped('VITE_CLERK_PUBLISHABLE_KEY'),
  clerkSyncHost: stamped('VITE_CLERK_SYNC_HOST'),
  uiOrigins: stamped('VITE_ENX_UI_ORIGINS').split(',').filter(Boolean),
  rssxOrigins: stamped('VITE_RSSX_ORIGINS').split(',').filter(Boolean),
  hanCharLimit: parseHanCharLimit(readBuildEnv('VITE_HAN_CHAR_LIMIT')),
  environment,
  buildCommit: readBuildEnv('VITE_BUILD_COMMIT'),
  builtAt: readBuildEnv('VITE_BUILD_TIME'),
}

// For debugging
console.log(
  `[ENX Config] Environment: ${config.environment}, API: ${config.apiBaseUrl}`
)
