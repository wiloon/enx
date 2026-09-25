import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      // The API client is same-origin (/api/*), so the rewrite target only has
      // to be a real URL; specs stub /api/** with page.route() anyway.
      API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',
      // Clerk (ADR-015). Dev instance publishable key is non-secret.
      CLERK_PUBLISHABLE_KEY:
        process.env.CLERK_PUBLISHABLE_KEY ||
        'pk_test_cmF0aW9uYWwtZGVlci00NDUwLmNsZXJrLmFjY291bnRzLmRldiQ',
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
      NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/app',
      NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/app',
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY || 'sk_test_placeholder',
    },
  },
})
