// ADR-037: signed-in e2e uses a real Clerk *development* instance session,
// created with @clerk/testing. There is no test-only auth bypass in enx-ui.

import { clerk, clerkSetup } from '@clerk/testing/playwright'
import { test as base } from '@playwright/test'

/** Dev-instance user to sign in as, e.g. `e2e+clerk_test@example.com`. */
export const E2E_USER_EMAIL = process.env.E2E_CLERK_USER_EMAIL ?? ''

/**
 * Signed-in specs need a dev-instance secret key and a test user. Without them
 * they are skipped, never faked.
 */
export const loginAvailable = Boolean(
  process.env.CLERK_SECRET_KEY && E2E_USER_EMAIL
)

export const LOGIN_SKIP_REASON =
  'needs CLERK_SECRET_KEY (Clerk dev instance) and E2E_CLERK_USER_EMAIL -- see ADR-037'

type TestFixtures = {
  /** Depend on this to run the test with `page` signed in to Clerk. */
  signedIn: void
}

type WorkerFixtures = {
  /** Fetches a Clerk Testing Token once per worker (bot-detection bypass). */
  clerkTesting: void
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  clerkTesting: [
    async ({}, provide) => {
      // Worker-scoped rather than a setup project: it sets CLERK_TESTING_TOKEN
      // on process.env, which only reaches the worker that ran it.
      await clerkSetup()
      await provide()
    },
    { scope: 'worker' },
  ],

  // `provide` is Playwright's fixture callback (usually named `use`), renamed
  // so react-hooks/rules-of-hooks does not mistake it for React's use().
  signedIn: async ({ page, clerkTesting }, provide) => {
    void clerkTesting
    // clerk.signIn needs a page that has loaded Clerk; the public landing
    // page does, and does not redirect.
    await page.goto('/')
    await clerk.signIn({ page, emailAddress: E2E_USER_EMAIL })
    await provide()
  },
})

export { expect } from '@playwright/test'
