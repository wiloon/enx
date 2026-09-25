import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  API_ORIGIN,
  FIXTURE_ORIGIN,
  loginAvailable,
  UI_ORIGIN,
} from './e2e/auth'

// ADR-037: a throwaway enx-api database per run, never the developer's own.
// Set on process.env so workers (which re-load this file) see the same path.
process.env.E2E_DB_PATH ??= join(
  mkdtempSync(join(tmpdir(), 'enx-e2e-')),
  'enx.db'
)

/**
 * Playwright configuration for ENX Chrome Extension E2E tests (ADR-037).
 *
 *   pnpm build:e2e && pnpm test:e2e
 *
 * Drives dist-e2e/ against a LOCAL enx-api (:8090), and -- only when Clerk
 * credentials are set -- a local enx-ui (:3000) to sign in on. Signed-in specs
 * skip without them. See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',

  // Homelab specs run against a live deployment via playwright.homelab.config.ts
  testIgnore: /homelab-.*\.spec\.ts/,

  // Run tests in files in parallel
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Single worker since we're testing an extension
  workers: 1,

  // Reporter to use
  // 'list' for terminal output, 'html' for interactive HTML report
  reporter: process.env.CI ? 'github' : 'list',

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: FIXTURE_ORIGIN,

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Extension must run in non-headless mode
        headless: false,
      },
    },
  ],

  // Folder for test artifacts such as screenshots, videos, traces, etc.
  outputDir: 'test-results/',

  // Run your local dev server before starting the tests
  webServer: [
    {
      // Backend API server (enx-api); set ECDICT_DB_PATH to a local ECDICT
      // SQLite file for translation tests. Never reused: an enx-api already on
      // :8090 is the developer's, with their real database.
      command: `cd ../enx-api && ENX_PORT=8090 ENX_DEV_MODE=true DB_PATH=${process.env.E2E_DB_PATH} ECDICT_DB_PATH=\${ECDICT_DB_PATH:-} go run .`,
      url: `${API_ORIGIN}/api/version`,
      reuseExistingServer: false,
      timeout: 60000, // `go run` compiles first
      stdout: 'pipe',
      stderr: 'pipe',
    },
    // The site the signed-in specs sign in on; the extension syncs its Clerk
    // session from here. Needs the same CLERK_SECRET_KEY (clerkMiddleware).
    ...(loginAvailable
      ? [
          {
            command: `cd ../enx-ui && API_BASE_URL=${API_ORIGIN} pnpm dev`,
            url: UI_ORIGIN,
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
          },
        ]
      : []),
    {
      // Frontend test fixtures server
      command: `npx http-server e2e/test-fixtures -p ${new URL(FIXTURE_ORIGIN).port} --silent`,
      url: FIXTURE_ORIGIN,
      // Not reused: a busy port must fail loudly, not serve someone else's pages
      reuseExistingServer: false,
      timeout: 10000,
    },
  ],
})
