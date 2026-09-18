// Environment configuration for ENX Chrome Extension
//
// The URLs themselves live in targets.ts and are injected by vite.config.ts at
// build time (`vite build --mode homelab|production`), so nothing here is
// hardcoded per deployment.

import {
  applyOverrides,
  DEFAULT_TARGET,
  resolveTargetName,
  TARGETS,
  type TargetName,
} from './targets'

export interface EnvConfig {
  apiBaseUrl: string
  frontendBaseUrl: string
  // Clerk (ADR-015). Publishable key is not secret; syncHost is the website
  // origin whose Clerk session the extension mirrors (@clerk/chrome-extension
  // ClerkProvider `syncHost`) so "logged in on the site -> logged in in the
  // extension" works without a second sign-in.
  clerkPublishableKey: string
  clerkSyncHost: string
  // Origins allowed on the web -> extension channel (ADR-019).
  uiOrigins: string[]
  environment: TargetName
}

// Jest sets JEST_WORKER_ID; avoid referencing the jest global in app code
const isTestEnv =
  typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined

const getEnvValue = (
  key: string,
  defaultValue?: string
): string | undefined => {
  if (isTestEnv) {
    return defaultValue
  }
  // import.meta.env is injected by Vite (see envPrefix / define in vite.config.ts)
  return (import.meta?.env?.[key] as string | undefined) ?? defaultValue
}

const mode = getEnvValue('MODE', isTestEnv ? 'test' : 'development')

const currentEnv: TargetName = isTestEnv
  ? 'test'
  : (resolveTargetName(getEnvValue('VITE_ENV')) ??
    resolveTargetName(mode) ??
    DEFAULT_TARGET)

// Export the active configuration
const target = applyOverrides(TARGETS[currentEnv], {
  VITE_API_BASE_URL: getEnvValue('VITE_API_BASE_URL'),
  VITE_FRONTEND_BASE_URL: getEnvValue('VITE_FRONTEND_BASE_URL'),
  VITE_CLERK_PUBLISHABLE_KEY: getEnvValue('VITE_CLERK_PUBLISHABLE_KEY'),
  VITE_CLERK_SYNC_HOST: getEnvValue('VITE_CLERK_SYNC_HOST'),
  VITE_ENX_UI_ORIGINS: getEnvValue('VITE_ENX_UI_ORIGINS'),
})

export const config: EnvConfig = {
  apiBaseUrl: target.apiBaseUrl,
  frontendBaseUrl: target.frontendBaseUrl,
  clerkPublishableKey: target.clerkPublishableKey,
  clerkSyncHost: target.clerkSyncHost,
  uiOrigins: target.uiOrigins,
  environment: target.name,
}

// For debugging
console.log(
  `[ENX Config] Environment: ${config.environment}, API: ${config.apiBaseUrl}`
)

// The options page can repoint the extension at another API server, which is
// how homelab/local debugging works. A production build must not do that: the
// background attaches a Clerk session JWT to every request, so an arbitrary URL
// is a token exfiltration path. There, only the build's own API is accepted.
export const apiBaseUrlOverrideAllowed = config.environment !== 'production'

const isAllowedApiBaseUrl = (url: string): boolean =>
  apiBaseUrlOverrideAllowed || url === config.apiBaseUrl

// Allow runtime override from storage
export const getApiBaseUrl = async (): Promise<string> => {
  try {
    const result = await chrome.storage.local.get(['apiBaseUrl'])
    if (result.apiBaseUrl) {
      if (!isAllowedApiBaseUrl(result.apiBaseUrl)) {
        console.warn(
          `[ENX Config] Ignoring stored API URL not allowed in this build: ${result.apiBaseUrl}`
        )
        return config.apiBaseUrl
      }
      console.log(
        `[ENX Config] Using custom API URL from storage: ${result.apiBaseUrl}`
      )
      return result.apiBaseUrl
    }
  } catch (error) {
    console.warn('[ENX Config] Failed to read API URL from storage:', error)
  }
  return config.apiBaseUrl
}

// Set custom API URL in storage
export const setApiBaseUrl = async (url: string): Promise<void> => {
  if (!isAllowedApiBaseUrl(url)) {
    throw new Error('Custom API URLs are disabled in this build')
  }
  try {
    await chrome.storage.local.set({ apiBaseUrl: url })
    console.log(`[ENX Config] Saved custom API URL: ${url}`)
  } catch (error) {
    console.error('[ENX Config] Failed to save API URL:', error)
  }
}

// Reset to default
export const resetApiBaseUrl = async (): Promise<void> => {
  try {
    await chrome.storage.local.remove('apiBaseUrl')
    console.log(`[ENX Config] Reset to default API URL: ${config.apiBaseUrl}`)
  } catch (error) {
    console.error('[ENX Config] Failed to reset API URL:', error)
  }
}
