// ADR-037: signed-in E2E uses a real Clerk *development* instance session,
// created with @clerk/testing on the local enx-ui and synced into the extension
// through `syncHost` -- the same path a user takes. There is no test-only auth
// bypass in the extension or enx-api.

import { DEV_CLERK_PUBLISHABLE_KEY, TARGETS } from '../src/config/targets'

/** enx-ui origin the e2e build syncs its Clerk session from (development target). */
export const UI_ORIGIN = TARGETS.development.frontendBaseUrl

/**
 * Static test pages (e2e/test-fixtures). build:e2e adds this origin to the
 * content-script origins; keep the port in step with package.json. Not 8080:
 * that is a busy port on dev machines, and a foreign server there would be
 * mistaken for the fixture server.
 */
export const FIXTURE_ORIGIN = 'http://localhost:8765'

/** Local enx-api the e2e build talks to (development target). */
export const API_ORIGIN = TARGETS.development.apiBaseUrl

// clerkSetup() and the sign-in-token flow read these from process.env.
process.env.CLERK_PUBLISHABLE_KEY ??= DEV_CLERK_PUBLISHABLE_KEY

/** Dev-instance user to sign in as, e.g. `e2e+clerk_test@example.com`. */
export const E2E_USER_EMAIL = process.env.E2E_CLERK_USER_EMAIL ?? ''

/**
 * Signed-in specs need a dev-instance secret key and a test user. Without them
 * they are skipped (never faked), and the enx-ui server is not started.
 */
export const loginAvailable = Boolean(
  process.env.CLERK_SECRET_KEY && E2E_USER_EMAIL
)

export const LOGIN_SKIP_REASON =
  'needs CLERK_SECRET_KEY (Clerk dev instance) and E2E_CLERK_USER_EMAIL -- see ADR-037'
