import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for ENX Chrome Extension E2E tests
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',

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
    baseURL: 'http://localhost:8080',

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
      // Mock Translation API (Node.js + Express)
      // Must start FIRST because enx-api depends on it
      command: 'cd ../mock-api && pnpm start',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Backend API server (enx-api) with E2E config
      // Uses config-e2e.toml which points to mock translation API
      command: 'cd ../enx-api && go run . -c config-e2e.toml',
      url: 'http://localhost:8090/api/version',
      reuseExistingServer: !process.env.CI,
      timeout: 30000, // API might take longer to start
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Frontend test fixtures server
      command: 'npx http-server e2e/test-fixtures -p 8080 --silent',
      url: 'http://localhost:8080',
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
    },
  ],
})
