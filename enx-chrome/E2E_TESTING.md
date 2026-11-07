# E2E Testing with Playwright

This document describes the E2E (End-to-End) testing setup for the ENX Chrome Extension using Playwright.

## Overview

The e2e suite loads the built extension into Playwright's Chromium and drives
it the way a user does: the popup, the options page, the content script on
static fixture pages, the side panel, and the enx-ui website it syncs its
session from. The design is in
[ADR-037](../docs/architecture/adr-037-e2e-testing-with-clerk-testing-tokens.md);
which test type to pick, and the Clerk credentials, are in
[docs/agents/testing.md](../docs/agents/testing.md).

There are two lanes:

- **Local** (`playwright.config.ts`, `pnpm test:e2e`): loads `dist-e2e/`,
  built by `pnpm build:e2e`, against a local stack Playwright starts itself
  (see [Local stack](#local-stack)). New feature e2e goes here.
- **HomeLab** (`playwright.homelab.config.ts`, `pnpm test:e2e:homelab`): loads
  `dist-homelab-test/`, built by `pnpm build:homelab-test`, against a deployed
  copy. Run by hand; see [HomeLab lane](#homelab-lane-run-by-hand).

## Prerequisites

From `enx-chrome/`:

```bash
pnpm install
pnpm exec playwright install chromium   # Playwright's own Chromium
pnpm build:e2e                          # dist-e2e/
```

The local stack also needs Go (enx-api runs with `go run`) and, for the
signed-in specs, enx-ui's dependencies installed (`pnpm install` in
`../enx-ui`). Rebuild `dist-e2e` after every change under `src/`: the tests
load the build, not the sources.

`E2E_CHROMIUM_PATH` points at an already-installed Chromium when Playwright's
own build is missing. It must be Chromium; branded Chrome ignores
`--load-extension`.

## Signing in

Signed-in specs sign a real user in on the Clerk **development** instance with
`@clerk/testing`; there is no test-only auth bypass in the extension or
enx-api. The credentials (`CLERK_SECRET_KEY`, `E2E_CLERK_USER_EMAIL`), where
to load them from and how to keep the key out of logs are in
[docs/agents/testing.md §E2E and Clerk sign-in](../docs/agents/testing.md#e2e-and-clerk-sign-in).

```bash
set -a; . ../enx-ui/.env.local; set +a   # CLERK_SECRET_KEY, never printed
export E2E_CLERK_USER_EMAIL=e2e+clerk_test@example.com
pnpm test:e2e
```

Two fixtures in `e2e/fixtures.ts` do the work (ADR-037 Decision 3):

- `clerkTesting` is **worker-scoped**. It calls `clerkSetup()` once per
  worker, which fetches a Testing Token (past the dev instance's bot
  detection) and writes `CLERK_TESTING_TOKEN` into that worker's
  `process.env`. It is a worker fixture rather than a setup project because
  the variable only reaches the process that set it.
- `signedIn` depends on `clerkTesting`. It opens enx-ui at `uiOrigin`
  (`http://localhost:3000` locally), calls `clerk.signIn({ page, emailAddress })`
  with a sign-in ticket, then polls the background's `validateSession` until
  the extension has synced the session and enx-api has accepted it. Locally it
  then seeds the fixture vocabulary for that user (`seedVocabulary` in
  `e2e/seed.ts`). A test asks for a session by naming the fixture:
  `async ({ page, extensionId, signedIn: _signedIn }) => …`.

Every test gets a fresh temporary browser profile, so each signed-in test
signs in again; nothing is shared through `storageState`. Specs that need a
brand-new account use `e2e/new-user.ts` instead (see
[Fresh-user onboarding](#fresh-user-onboarding-467)).

Without `CLERK_SECRET_KEY` and `E2E_CLERK_USER_EMAIL`, the local lane skips the
signed-in specs with `LOGIN_SKIP_REASON` (from `e2e/auth.ts`) and does not
start enx-ui. Specs that need no sign-in still run: `options-page`,
`billing-startup`, `product-config` and the signed-out parts of `popup-login`.

## Running Tests

### Basic Commands

```bash
pnpm test:e2e            # all local specs, headless (task test-e2e)
pnpm test:e2e:ui         # Playwright UI mode (task test-e2e-ui)
pnpm test:e2e:debug      # step through with the Inspector (task test-e2e-debug)
pnpm test:e2e:headed     # show the browser windows (task test-e2e-headed)
pnpm test:all            # unit tests, then e2e (task test-all)
```

None of these build the extension; run `pnpm build:e2e` first.

### Running Specific Tests

```bash
# One spec file
pnpm test:e2e e2e/popup-login.spec.ts

# Tests whose title matches a pattern
pnpm test:e2e --grep "sign out"

# The test at one line
pnpm test:e2e e2e/popup-login.spec.ts:9
```

The local API, UI, fixture and Stripe adapter output is saved to
`test-results/servers/enx-api.log`, `test-results/servers/enx-ui.log` and
`test-results/servers/fixtures.log`, plus `test-results/servers/stripe.log`. If a server exits during startup, its
last 50 log lines are printed. Set `E2E_SERVER_LOGS=1` to stream server output
instead. Playwright test artifacts are in `test-results/artifacts/`.

## HomeLab lane (run by hand)

`playwright.homelab.config.ts` drives the `dist-homelab-test` build against
HomeLab's automated-test copy, `https://enx-test.wiloon.lab` and
`https://enx-api-test.wiloon.lab` (ADR-037 Decision 6; w10n-config ADR-0007).
That copy answers AI requests with `enx-fake-ai`, has its own database and is
the only one with Stripe webhooks. `enx.wiloon.lab` is the copy on the real AI
for manual checks; the lane never touches it (grant credits there through the
admin API). It starts no local servers and checks only what the local stack
cannot see: the stamped `/api/version` commit, the extension ID, enx-api's
auth (401 for no token and a garbage token) and CORS for the extension's
origin, session sync from the HomeLab site, one lookup on
`/reader/sample` counted on `/words`, and one Small top-up paid in Stripe
Sandbox Checkout that grants exactly 300 top-up credits (see
[Top-up payment test](#top-up-payment-test)). Run it before the internal beta and
before a release; nothing runs it on a schedule or in CI. New feature e2e
belongs in the local suite, not here. The normal `pnpm test:e2e` ignores
`homelab-*.spec.ts`.

It needs the Clerk **development** credentials: `CLERK_SECRET_KEY`
(`sk_test_…`) and `E2E_CLERK_USER_EMAIL`. Without them the signed-in tests
fail; they never skip, so a hand run cannot pass empty.

```bash
set -a; . ../enx-ui/.env.local; set +a   # CLERK_SECRET_KEY, never printed
export E2E_CLERK_USER_EMAIL=e2e+clerk_test@example.com
pnpm build:homelab-test                   # dist-homelab-test/
pnpm test:e2e:homelab                     # headless; add --headed to watch it
```

The lane writes to the enx-test database as the e2e user and seeds nothing
(that database is not reachable from here). To start from an empty database,
see "Resetting the test database" in w10n-config `infra/homelab/k8s/enx-test/README.md`. The lookup test reads the `reliable`
row's count before and after, so run it while nobody else uses that account.
After the first run caches `reliable`, the lookup no longer proves ECDICT is
available on HomeLab.

Two trust stores need the homelab CA: Node's (`NODE_EXTRA_CA_CERTS=<ca.crt>`)
for the `fetch` checks, and Chromium's. On Linux, Chromium reads the user's
NSS database (`~/.pki/nssdb`; add the CA with `certutil`).

### Top-up payment test

`a Small top-up paid in Stripe Sandbox Checkout grants exactly 300 top-up
credits` reads **Top-up credit balance** on `/billing`, clicks **Buy** on
**Small top-up**, pays on `checkout.stripe.com` with the test card
`4242 4242 4242 4242`, waits for `/billing/success`, then reloads `/billing`
until the balance is exactly 300 above where it started. The webhook that
grants the credits is asynchronous (forwarded by `enx-stripe-cli`), so the
success page alone proves nothing. It prints whether Checkout used the e2e
user's existing Stripe Customer or none.

Each run adds a Sandbox payment and 300 top-up credits to the e2e user, for
good. The test needs exclusive use of that shared account for the whole
before/after measurement: coordinate runs, and keep everyone else off the
account meanwhile. A gain of +600 usually means two runs overlapped; check for
a concurrent run before suspecting a double grant.

Stripe Checkout often stops a Pay click with an invisible hCaptcha challenge,
and Checkout then never confirms the payment. On 2026-11-01, headless on ser8,
three payments went through and then every attempt stalled; headed on macOS,
two of three attempts stalled. So this one test is a hand run before a release:
it runs only in headed Chromium on macOS and is skipped everywhere else with
that reason. The rest of the lane still runs headless on ser8.

One passing run is enough. A failure that names the hCaptcha challenge bought no
credits and says nothing about ENX, so run the test again later. Do not use
`--repeat-each`, because repeated payments make a challenge more likely. Never
work around the challenge.

A headed run on macOS, from `enx-chrome/`:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium     # Playwright's own Chromium
set -a; . ../enx-ui/.env.local; set +a    # CLERK_SECRET_KEY, never printed
export E2E_CLERK_USER_EMAIL=e2e+clerk_test@example.com
export NODE_EXTRA_CA_CERTS=/path/to/homelab-ca.crt   # Node's fetch checks
pnpm build:homelab-test                   # dist-homelab-test/
ENX_HOMELAB=1 pnpm test:e2e:homelab --headed -g 'Small top-up' --retries=0
```

Drop `-g` and `--retries` to run the whole lane headed.

Chromium on macOS trusts what the macOS keychain trusts, so add the HomeLab
CA there once:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain /path/to/homelab-ca.crt
```

Check both trust stores with certificate verification on (never
`NODE_TLS_REJECT_UNAUTHORIZED=0` or `--ignore-certificate-errors`):

```bash
# Node: prints 200 only if NODE_EXTRA_CA_CERTS makes the chain valid
node -e "fetch('https://enx-api.wiloon.lab/api/version').then(r => console.log(r.status))"
# macOS keychain (what Chromium uses): "...certificate verification successful"
openssl s_client -connect enx.wiloon.lab:443 -servername enx.wiloon.lab \
  </dev/null 2>/dev/null | openssl x509 > /tmp/enx-homelab-leaf.pem
security verify-cert -c /tmp/enx-homelab-leaf.pem -p ssl -s enx.wiloon.lab
```

`security verify-cert` can instead report missing certificate transparency
timestamps (SCTs) for the private CA. On 2026-11-01 Chromium still loaded the
HomeLab site with that report.

`homelab-x-tweet-rebuild.spec.ts` stays skipped: x.com is injected on demand,
which Playwright cannot grant.

## Local billing dependency

Playwright starts `e2e/fake-stripe/server.mjs` on `127.0.0.1:12112` before the
API. It overrides `STRIPE_API_BASE_URL`, `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` with the local endpoint and fixed non-secret fixture
values, and clears Portal configuration overrides. No Stripe dashboard setup or
real Stripe key is required. The normal API startup validation, billing workers
and webhook signature checks remain enabled.

The adapter serves account discovery, configured subscription Prices and safe
Portal configuration reads. Other requests, including all payment mutations,
return 501; it never forwards requests to Stripe. `/requests` exposes only request
methods and paths for startup assertions. Edit the adapter when a test needs a
new response; it is not a payment lifecycle simulator. Billing E2E tests here do
not prove real Stripe payments or webhook processing.

`STRIPE_API_BASE_URL` is the API's normal optional endpoint setting: unset uses
the Stripe SDK endpoints. The E2E stack routes every SDK backend to the local
adapter. Signed-in tests still contact the real Clerk **development** instance
through `@clerk/testing` and session sync, and need the documented dev credentials.
No local authentication substitute is used. AI-provider wiring remains separate
(#466).

## Test Structure

### Directory Layout

```
enx-chrome/
├── e2e/
│   ├── *.spec.ts                  # the specs (homelab-*.spec.ts: HomeLab lane only)
│   ├── fixtures.ts                # context, extensionId, clerkTesting, signedIn
│   ├── new-user.ts                # fixtures for a fresh Clerk user per test
│   ├── auth.ts                    # origins, extension ID, Clerk env, LOGIN_SKIP_REASON
│   ├── helpers.ts                 # page helpers (see below)
│   ├── seed.ts                    # direct writes to the throwaway SQLite database
│   ├── product-config.ts          # reads the credit terms from enx-api/config.toml
│   ├── fake-stripe/server.mjs     # local Stripe adapter
│   └── test-fixtures/             # static pages served on http://localhost:8765
├── playwright.config.ts           # local lane
├── playwright.homelab.config.ts   # HomeLab lane
├── dist-e2e/                      # pnpm build:e2e (local lane)
└── dist-homelab-test/             # pnpm build:homelab-test (HomeLab lane)
```

`ls e2e/*.spec.ts` lists the specs; each one's `test.describe` title says what
it covers. The local config ignores `homelab-*.spec.ts`.

### Local stack

`playwright.config.ts` starts every server the local lane needs and stops it
afterwards. Output goes to `test-results/servers/<name>.log` (see above).

| Server | Address | Notes |
|---|---|---|
| Fake AI (`../enx-fake-ai/server.mjs`) | `http://127.0.0.1:12113` | see [Deterministic AI](#deterministic-ai-and-trial-credits) |
| Fake Stripe (`e2e/fake-stripe/server.mjs`) | `http://127.0.0.1:12112` | see [Local billing dependency](#local-billing-dependency) |
| enx-api (`go run . -c config.toml`) | `http://localhost:8091` | `API_ORIGIN` in `e2e/auth.ts`, the development target's API |
| enx-ui (`next dev`) | `http://localhost:3000` | `UI_ORIGIN`; started only when the Clerk credentials are set |
| Fixture pages (`http-server e2e/test-fixtures`) | `http://localhost:8765` | `FIXTURE_ORIGIN`; also Playwright's `baseURL` |

enx-api gets a throwaway SQLite database per run (`E2E_DB_PATH`, in a new
temporary directory), never the developer's own. Only enx-ui is reused when
already running, and not on CI; any other busy port fails the run instead of
serving someone else's pages or data.

`pnpm build:e2e` adds `http://localhost:8765` to the content script's matches
(`VITE_CONTENT_SCRIPT_ORIGINS`) and `http://localhost:3000` to the enx-ui
origins, so the content script runs on the fixture pages and the extension
syncs its session from local enx-ui. A spec opens a fixture page with a path
relative to `baseURL`, e.g. `page.goto('/test-page.html')`. The pages are
`test-page.html`, `typescript-page.html`, `body-paragraphs.html` and
`paint-window.html`.

It also adds `https://standardebooks.org`, which no server answers:
`standard-ebooks.spec.ts` fulfils those URLs with `context.route()` from the
`standard-ebooks-*.xhtml` fixtures, served as `application/xhtml+xml` like
the real pages, so the Standard Ebooks site adapter resolves.

### Key Files

#### `playwright.config.ts`

- **Test directory**: `./e2e`, ignoring `homelab-*.spec.ts`
- **Browser**: one Chromium project, `headless: true`; `--headed` shows the
  windows
- **Workers**: 1, `fullyParallel: false`
- **Retries**: 2 on CI, none locally
- **Artifacts**: screenshot on failure, video kept on failure, trace on the
  first retry, all in `test-results/artifacts/`

#### `e2e/fixtures.ts`

- `context`: launches a persistent context with a fresh temporary profile
  per test, loading the extension from `extensionDir` (`dist-e2e` by default;
  the HomeLab config sets `dist-homelab-test`). It throws if the build is
  missing. It uses `channel: 'chromium'`, because headless mode only loads
  extensions in full Chromium, not in `chromium-headless-shell`.
- `extensionId`: read from the background service worker's URL.
- `clerkTesting` and `signedIn`: see [Signing in](#signing-in).

#### `e2e/helpers.ts`

- `openPopup(page, extensionId)`, `openOptions(page, extensionId)`: open the
  popup or options page in `page`
- `setHighlightPref(page, extensionId, enabled)`: flip the highlight
  preference on the options page
- `enableLearningMode(page, extensionId)`: turn on learning mode for the tab
  showing `page`, through the popup's `chrome.tabs` access
- `waitForContentScript(page, { emptyReviewList })`: wait until highlights are
  painted (or, with `emptyReviewList`, until the content script's styles are in)
- `getHighlightedWords(page)`, `getHighlightedWordsCount(page)`,
  `getHighlightNames(page)`, `isWordHighlighted(page, text)`: read the
  highlights from `CSS.highlights`
- `clickHighlightedWord(page, index)`, `clickWordAndWaitForPopup(page, index)`:
  click the nth highlighted word
- `clickWord(page, word, paragraphSelector)`: click a word whether or not it
  is highlighted, and return the popover
- `mockBackendFetch(context, options)`: stub enx-api inside the service
  worker; `reviewWordsRequests(context)` and `wordLookupPosts(context)` read
  what it recorded
- `aiCompletionCount(feature)`: completions the fake AI answered this run
- `clearStorage(page)`: clear `chrome.storage.local`

### Highlights

Highlighting uses the CSS Custom Highlight API, so there are no marker
elements or classes to select. A highlighted word is a `Range`
registered in `CSS.highlights` under a name starting with `enx-hl-`
(`HIGHLIGHT_NAME_PREFIX` in `e2e/helpers.ts`, kept in step with
`src/lib/wordProcessor.ts`). Read highlights with the helpers above, and click
a word by its on-screen coordinates (`clickHighlightedWord`, `clickWord`). The
word popover renders in `#enx-anchored-overlay`.

## Writing New Tests

### Example Test

```typescript
import { loginAvailable, LOGIN_SKIP_REASON } from './auth'
import { expect, test } from './fixtures'
import {
  clickWordAndWaitForPopup,
  enableLearningMode,
  waitForContentScript,
} from './helpers'

test.describe('Word popover', () => {
  test.skip(!loginAvailable, LOGIN_SKIP_REASON)

  test('clicking a highlighted word opens the popover', async ({
    page,
    extensionId,
    signedIn: _signedIn,
  }) => {
    await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
    await enableLearningMode(page, extensionId)
    await waitForContentScript(page)

    await clickWordAndWaitForPopup(page, 0)

    await expect(page.locator('#enx-anchored-overlay')).toBeVisible()
  })
})
```

### Best Practices

1. **Build first**: the tests load `dist-e2e/`; rebuild after changing `src/`.
2. **Skip at describe level**: put `test.skip(!loginAvailable, LOGIN_SKIP_REASON)`
   on the `describe`, so `signedIn` never runs without credentials.
3. **Use the fixture pages**: no external websites; add a page to
   `e2e/test-fixtures/` when a test needs new markup.
4. **Real backend by default**: signed-in specs run against the local enx-api
   with seeded vocabulary. Use `mockBackendFetch` only for answers the local
   stack cannot give (an expired session, a failed translation). It patches
   `fetch` inside the service worker, because `context.route()` does not see
   service-worker requests.
5. **Wait on state, not time**: `expect(...).toBeVisible()`,
   `waitForContentScript` and `expect(…).toPass()` rather than `waitForTimeout`.
6. **Name the behaviour**: see [docs/agents/testing.md §Writing tests](../docs/agents/testing.md#writing-tests).

### Common Patterns

#### Navigate to Extension Pages

```typescript
await openPopup(page, extensionId)    // chrome-extension://<id>/popup.html
await openOptions(page, extensionId)  // chrome-extension://<id>/options.html
```

#### Interact with Content Scripts

```typescript
await page.goto('/test-page.html', { waitUntil: 'domcontentloaded' })
await enableLearningMode(page, extensionId)
await waitForContentScript(page)

expect(await getHighlightedWordsCount(page)).toBeGreaterThan(0)
```

#### Check Chrome Storage

```typescript
// From an extension page (popup, options), where `chrome.storage` exists
const value = await page.evaluate(() => chrome.storage.local.get('key'))
```

## Debugging Tests

### Visual Debugging

`pnpm test:e2e:ui` opens Playwright's UI mode: watch a run, inspect the DOM
at each step and re-run single tests. `pnpm test:e2e:debug` opens the
Playwright Inspector and pauses before each action.

### Artifacts

A failed test leaves a screenshot and a video in `test-results/artifacts/`.
Traces are recorded only on a retry, and local runs do not retry; add
`--trace on` to record one, then open it:

```bash
pnpm test:e2e e2e/popup-login.spec.ts --trace on
pnpm exec playwright show-trace test-results/artifacts/<test-dir>/trace.zip
```

## Troubleshooting

### `dist-e2e/ is not built`

The `context` fixture found no `dist-e2e/manifest.json`. Run `pnpm build:e2e`.

### Chromium missing or the service worker never starts

Run `pnpm exec playwright install chromium`, or set `E2E_CHROMIUM_PATH` to an
installed Chromium (not branded Chrome, which ignores `--load-extension`). A
custom launch must keep `channel: 'chromium'`: `chromium-headless-shell`
cannot load extensions, so the service worker never appears.

### A server fails to start

Read `test-results/servers/<name>.log`; the last 50 lines are also printed.
The usual cause is a busy port (8091, 8765, 12112 or 12113): stop whatever
holds it, since the config refuses to reuse it.

### Signed-in specs are skipped

`CLERK_SECRET_KEY` or `E2E_CLERK_USER_EMAIL` is not set in the shell that runs
Playwright; see [Signing in](#signing-in).

### The content script does nothing on a page

Serve the fixture page from `http://localhost:8765` (a path relative to
`baseURL`). Call `enableLearningMode` before
`waitForContentScript`. If the user's review list is empty there is nothing
to paint; pass `{ emptyReviewList: true }` to `waitForContentScript`.

### Word lookups answer 503

ECDICT is not configured; see
[AI word fallback and running out of credits](#ai-word-fallback-and-running-out-of-credits-471)
for how the config finds it.

## CI/CD Integration

The enx-chrome CI workflow (`.github/workflows/enx-chrome-ci.yml`) runs lint,
unit tests, typecheck and the production build, not e2e: the signed-in specs
need the Clerk development key and a running enx-api and enx-ui. Run the
specs your change touches locally before opening a PR. An issue that needs a
specific or repeated run names it in an `## E2E gate` section; see
[docs/agents/testing.md](../docs/agents/testing.md#e2e-and-clerk-sign-in).

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Testing Chrome Extensions](https://playwright.dev/docs/chrome-extensions)
- [Debugging Tests](https://playwright.dev/docs/debug)
- [Best Practices](https://playwright.dev/docs/best-practices)

## Deterministic AI and trial credits

The local stack starts `../enx-fake-ai/server.mjs` at
`http://127.0.0.1:12113` and configures the real ENX DeepSeek client to use it
with a dummy key. It supports all five AI response contracts and returns
fixed non-zero token usage. Edit its `fixtures` array to change the answers;
see `../enx-fake-ai/README.md` for running it as a HomeLab container.

The API uses a fixed E2E email HMAC key so normal sign-in grants trial credits
in the disposable database. `ai-credits.spec.ts` reads the trial balance on
Billing, translates through the real side panel, and checks credits were
spent. It does not seed credit balances or mock backend responses. Clerk
still uses real development-instance authentication over the network; only
AI calls must stay inside the test environment. `test-results/servers/ai.log`
records each completion's feature without logging prompts or credentials.

## AI word fallback and running out of credits (#471)

`ai-word-and-credits.spec.ts` needs ECDICT: only a clean dictionary miss offers
the AI fallback, and without ECDICT a missing word answers 503. When
`ECDICT_DB_PATH` is unset, `playwright.config.ts` uses
`~/.local/share/enx/ecdict/stardict.db` if that file exists (`task
ecdict:download` fetches it). With Clerk credentials set and no ECDICT, these
specs fail with that message rather than skip.

Each test uses a fresh user (`new-user.ts`) and a new letters-only word that
it inserts into the fixture page at runtime, so the word misses both `words`
and ECDICT. The AI fallback test clicks "Look up with AI" and checks the fake
definition, the AI badge, one more `word-definition` completion and a lower
trial balance on Billing. The out-of-credit tests set the user's
`credit_accounts.trial_balance` to 0 in SQLite (`zeroTrialBalance` in
`seed.ts`) and check the locked word lookup and the side panel's
insufficient-credit error, with no completions made. Completions are counted
from `test-results/servers/ai.log`, so these specs fail under
`E2E_SERVER_LOGS=1`.

```bash
pnpm test:e2e ai-word-and-credits.spec.ts --repeat-each=3
```

## Fresh-user onboarding (#467)

`new-user-welcome.spec.ts` uses `new-user.ts` rather than the shared
`signedIn` fixture: each test creates a random `+clerk_test` user through the
Clerk Backend SDK, signs in with `@clerk/testing`, and waits for the extension's
real session sync. It seeds no vocabulary, onboarding preferences or credits.
The shared `signedIn` fixture targets vocabulary seeds using the local user
identity returned by `/api/me`, so it works after fresh-user scenarios have
added other accounts to the disposable database.
The Billing assertion reads the expected grant from `[credits.trial] amount`
in `enx-api/config.toml`.

Use the existing development Clerk credentials from the sign-in setup above.
The **development instance** must enable **Sign-up with email**; it may keep
**Verify at sign-up** enabled and **Sign-in with email** disabled. The Backend
API creates verified test addresses and the testing helper uses a sign-in
ticket. Email passwords, email-code sign-in and real mail delivery are not
needed. Production authentication remains Google and GitHub only; these tests
refuse a production secret key.

The first lookup needs the real read-only ECDICT file, found the same way as
for the AI word fallback above; without it that test fails with a message
saying so, and the trial-credit test still runs. Do not seed the word: a seed
would hide this dependency. After loading the Clerk development credentials and
building `dist-e2e`, run:

```bash
pnpm test:e2e new-user-welcome.spec.ts --repeat-each=3
```

To run without ECDICT even though the default file exists, set
`ECDICT_DB_PATH=` (empty).

To prove the trial assertion catches a missing grant, run the trial test with
`CREDITS_TRIAL_AMOUNT=0`. It must fail on the missing configured trial-credit
text on Billing, not during setup. Restore the normal environment afterwards.

Cleanup runs in `finally`, including when login or assertions fail: delete the
created Clerk user, query by its ID, assert both an empty list and a zero count,
and attach `clerk-user-cleanup` to the Playwright report. This does not delete
any shared test user. As with any process teardown, forcibly killing the worker
can interrupt cleanup; check Clerk Users for this fixture's
`e2e-new-…+clerk_test@example.com` addresses and remove any leftover.

### Manual checks

In real Chrome, pin Catglish to the toolbar while `/welcome` is visible and
check that the pin step changes to Done. Playwright covers the Skip path and
uses the toolbar's public `enxRun` message to enable learning mode; it cannot
click Chrome's toolbar or pin control. Loading an unpacked extension in this
spec also does not verify a Chrome Web Store installation.
