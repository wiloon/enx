import { defineConfig, devices } from '@playwright/test'
import type { ExtensionOptions } from './e2e/fixtures'
import { TARGETS } from './src/config/targets'

/**
 * Playwright config for the HomeLab lane (ADR-037 Decision 6), run by hand.
 *
 * Unlike playwright.config.ts this starts NO local servers -- it drives the
 * built extension (dist-homelab/) against https://enx.wiloon.lab and
 * https://enx-api.wiloon.lab, signed in on the Clerk dev instance.
 *
 *   pnpm build                 # produces dist-homelab/ with VITE_ENV=homelab
 *   pnpm test:e2e:homelab      # add --headed to watch it; see E2E_TESTING.md
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
    // e2e/fixtures.ts defaults to dist-e2e and the local stack (ADR-037)
    extensionDir: 'dist-homelab',
    uiOrigin: TARGETS.homelab.frontendBaseUrl,
    // seedVocabulary writes SQLite directly; HomeLab's database is not reachable
    seedsVocabulary: false,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
      },
    },
  ],

  outputDir: 'test-results/homelab',
})
