// Mock for env.ts in test environment
export const config = {
  apiBaseUrl: 'http://localhost:8090',
  environment: 'test' as const,
}

export const getApiBaseUrl = async (): Promise<string> => {
  return config.apiBaseUrl
}

export const setApiBaseUrl = async (_url: string): Promise<void> => {
  // Mock implementation
}

export const resetApiBaseUrl = async (): Promise<void> => {
  // Mock implementation
}
