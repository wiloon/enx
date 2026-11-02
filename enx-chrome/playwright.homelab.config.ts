import { defineConfig, devices } from '@playwright/test'
import type { ExtensionOptions } from './e2e/fixtures'
import { TARGETS } from './src/config/targets'

/**
 * Playwright config for the HomeLab lane (ADR-037 Decision 6), run by hand.
 *
 * Unlike playwright.config.ts this starts NO local servers -- it drives the
 * built extension (dist-homelab-test/) against https://enx-test.wiloon.lab and
 * https://enx-api-test.wiloon.lab, signed in on the Clerk dev instance. That is
 * HomeLab's automated-test copy: fake AI, its own database, the only copy with
 * Stripe webhooks (w10n-config ADR-0007). `enx.wiloon.lab` is the copy on the
 * real AI and is not tested here.
 *
 *   pnpm build:homelab-test    # produces dist-homelab-test/
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
    extensionDir: 'dist-homelab-test',
    uiOrigin: TARGETS['homelab-test'].frontendBaseUrl,
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
