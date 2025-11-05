// Environment configuration for ENX Chrome Extension

export interface EnvConfig {
  apiBaseUrl: string
  environment: 'development' | 'production' | 'staging'
}

// Default configuration based on environment
const isDevelopment = import.meta.env.DEV
const isProduction = import.meta.env.PROD

// Environment-specific defaults
const ENV_CONFIG: Record<string, EnvConfig> = {
  development: {
    apiBaseUrl: 'http://localhost:8090',
    environment: 'development',
  },
  production: {
    apiBaseUrl: 'https://enx.wiloon.com',
    environment: 'production',
  },
  staging: {
    apiBaseUrl: 'https://enx-dev.wiloon.com',
    environment: 'staging',
  },
}

// Auto-detect environment or use override
const getEnvironment = (): string => {
  // Check for environment variable override
  const envOverride = import.meta.env.VITE_ENV
  if (envOverride && ENV_CONFIG[envOverride]) {
    return envOverride
  }

  // Auto-detect based on build mode
  if (isDevelopment) {
    return 'development'
  }
  if (isProduction) {
    return 'production'
  }
  return 'staging'
}

// Export the active configuration
const currentEnv = getEnvironment()
export const config: EnvConfig = ENV_CONFIG[currentEnv]

// For debugging
console.log(`[ENX Config] Environment: ${config.environment}, API: ${config.apiBaseUrl}`)

// Allow runtime override from storage
export const getApiBaseUrl = async (): Promise<string> => {
  try {
    const result = await chrome.storage.local.get(['apiBaseUrl'])
    if (result.apiBaseUrl) {
      console.log(`[ENX Config] Using custom API URL from storage: ${result.apiBaseUrl}`)
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
