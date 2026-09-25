import { defineConfig, devices } from '@playwright/test'
import type { ExtensionOptions } from './e2e/fixtures'

/**
 * Playwright config for running E2E against the HOMELAB deployment.
 *
 * Unlike playwright.config.ts this starts NO local servers -- it drives the
 * built extension (dist-homelab/) against https://enx-api.wiloon.lab and real Cognito.
 *
 *   pnpm build                 # produces dist-homelab/ with VITE_ENV=homelab
 *   pnpm test:e2e:homelab      # see package.json
 *
 * Gated on ENX_HOMELAB=1 so it never runs in the normal suite / CI by accident.
 */
export default defineConfig<ExtensionOptions>({
  testDir: './e2e',
  testMatch: /homelab-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60_000,

  use: {
    // e2e/fixtures.ts defaults to dist-e2e (local stack, ADR-037)
    extensionDir: 'dist-homelab',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
      },
    },
  ],

  outputDir: 'test-results/homelab',
})
