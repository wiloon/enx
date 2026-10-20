// Mock for env.ts in test environment
export const config = {
  apiBaseUrl: 'http://localhost:8090',
  frontendBaseUrl: 'http://localhost:3000',
  clerkPublishableKey: 'pk_test_x',
  clerkSyncHost: 'http://localhost:3000',
  uiOrigins: ['http://localhost:3000'],
  environment: 'test' as const,
}
