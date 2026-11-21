import { defineConfig, devices } from '@playwright/test'
import { SITE } from './src/lib/site'

// Test-owned API stub for /pricing's server fetch (issue #1082). Fixed port
// so Next can take the origin as API_BASE_URL when both webServers start.
const E2E_API_STUB_ORIGIN = 'http://127.0.0.1:18091'

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
  webServer: [
    {
      command: 'node ./e2e/free-daily-lookup-limit-stub.mjs',
      url: `${E2E_API_STUB_ORIGIN}/api/dictionary/free-daily-lookup-limit`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Same as `pnpm dev`, but without pnpm in between: pnpm 12's native
      // binary starts the script in a new process group, so Playwright's
      // teardown (SIGKILL to the webServer's group) misses next dev, which then
      // holds the output pipe open until the teardown timeout and lingers on
      // :3000 to block the next run.
      command: './node_modules/.bin/next dev --turbopack',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      env: {
        // Server components (e.g. /pricing) fetch enx-api directly; the stub
        // answers the free-limit endpoint. Force the stub origin so a
        // developer API_BASE_URL from .env.local cannot bypass it. Browser-
        // side specs still stub /api/** with page.route().
        API_BASE_URL: E2E_API_STUB_ORIGIN,
        ENX_EXTENSION_ID: SITE.chromeExtensionId,
        ENX_EXTENSION_WEB_STORE_URL: SITE.chromeWebStoreUrl,
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
  ],
})
