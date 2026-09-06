// Environment configuration for ENX Chrome Extension

export interface EnvConfig {
  apiBaseUrl: string
  frontendBaseUrl: string
  // Clerk (ADR-015). Publishable key is not secret; syncHost is the website
  // origin whose Clerk session the extension mirrors (@clerk/chrome-extension
  // ClerkProvider `syncHost`) so "logged in on the site -> logged in in the
  // extension" works without a second sign-in.
  clerkPublishableKey: string
  clerkSyncHost: string
  environment: 'development' | 'production' | 'staging' | 'test'
}

// Clerk *development* instance (rational-deer-4450). Production builds override
// via VITE_CLERK_PUBLISHABLE_KEY once a production Clerk instance exists.
const DEV_CLERK_PUBLISHABLE_KEY =
  'pk_test_cmF0aW9uYWwtZGVlci00NDUwLmNsZXJrLmFjY291bnRzLmRldiQ'

// Jest sets JEST_WORKER_ID; avoid referencing the jest global in app code
const isTestEnv =
  typeof process !== 'undefined' && process.env.JEST_WORKER_ID !== undefined

const getEnvValue = (key: string, defaultValue: any = undefined) => {
  if (isTestEnv) {
    return defaultValue
  }
  // @ts-ignore - import.meta.env is available in Vite
  return import.meta?.env?.[key] ?? defaultValue
}

// Default configuration based on environment
const isDevelopment = getEnvValue('DEV', false)
const isProduction = getEnvValue('PROD', false)
const mode = getEnvValue('MODE', isTestEnv ? 'test' : 'development')

// Environment-specific defaults
const ENV_CONFIG: Record<string, EnvConfig> = {
  development: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    clerkPublishableKey:
      getEnvValue('VITE_CLERK_PUBLISHABLE_KEY') || DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost:
      getEnvValue('VITE_CLERK_SYNC_HOST') || 'http://localhost:3000',
    environment: 'development',
  },
  production: {
    apiBaseUrl: 'https://enx-api.wiloon.com',
    frontendBaseUrl: 'https://enx.wiloon.com',
    clerkPublishableKey:
      getEnvValue('VITE_CLERK_PUBLISHABLE_KEY') || DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost:
      getEnvValue('VITE_CLERK_SYNC_HOST') || 'https://enx.wiloon.com',
    environment: 'production',
  },
  staging: {
    apiBaseUrl: 'https://enx-api.wiloon.lab',
    frontendBaseUrl: 'https://enx.wiloon.lab',
    clerkPublishableKey:
      getEnvValue('VITE_CLERK_PUBLISHABLE_KEY') || DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost:
      getEnvValue('VITE_CLERK_SYNC_HOST') || 'https://enx.wiloon.lab',
    environment: 'staging',
  },
  test: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    clerkPublishableKey: DEV_CLERK_PUBLISHABLE_KEY,
    clerkSyncHost: 'http://localhost:3000',
    environment: 'test',
  },
}

// Auto-detect environment or use override
const getEnvironment = (): string => {
  console.log('🔧 getEnvironment() - Debug info:')
  console.log('  isTestEnv:', isTestEnv)
  console.log('  mode:', mode)
  console.log('  isDevelopment:', isDevelopment)
  console.log('  isProduction:', isProduction)

  // Test environment
  if (isTestEnv || mode === 'test') {
    console.log('  → Detected: test')
    return 'test'
  }

  // Check for environment variable override
  const envOverride = getEnvValue('VITE_ENV')
  console.log('  VITE_ENV override:', envOverride)

  if (envOverride && ENV_CONFIG[envOverride]) {
    console.log('  → Using VITE_ENV override:', envOverride)
    return envOverride
  }

  // Auto-detect based on build mode
  // In Vite dev mode, mode is 'development' even if DEV/PROD are undefined
  if (mode === 'development' || isDevelopment) {
    console.log('  → Auto-detected: development (mode or DEV flag)')
    return 'development'
  }
  if (isProduction) {
    console.log('  → Auto-detected: production')
    return 'production'
  }

  console.log('  → Fallback: staging')
  return 'staging'
}

// Export the active configuration
const currentEnv = getEnvironment()
export const config: EnvConfig = ENV_CONFIG[currentEnv]

// For debugging
console.log(
  `[ENX Config] Environment: ${config.environment}, API: ${config.apiBaseUrl}`
)

// Allow runtime override from storage
export const getApiBaseUrl = async (): Promise<string> => {
  try {
    const result = await chrome.storage.local.get(['apiBaseUrl'])
    if (result.apiBaseUrl) {
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
