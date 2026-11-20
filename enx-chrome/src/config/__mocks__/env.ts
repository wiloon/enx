// Mock for env.ts in test environment
export const config = {
  apiBaseUrl: 'http://localhost:8090',
  frontendBaseUrl: 'http://localhost:3000',
  auth: {
    provider: 'clerk' as const,
    publishableKey: 'pk_test_x',
    syncHost: 'http://localhost:3000',
  },
  uiOrigins: ['http://localhost:3000'],
  rssxOrigins: [] as string[],
  environment: 'test' as const,
}
