# E2E Testing with Playwright

This document describes the E2E (End-to-End) testing setup for the ENX Chrome Extension using Playwright.

## Overview

Playwright provides powerful browser automation capabilities that allow us to test the Chrome extension in a real browser environment. This includes testing:

- Popup interactions (login, buttons, state)
- Content script functionality (word highlighting, translation)
- Options page configuration
- Extension lifecycle and state persistence

## Prerequisites

1. **Build the extension first**:

   ```bash
   pnpm run build
   # or
   task build
   ```

2. **Install Playwright browsers** (if not already done):
   ```bash
   npx playwright install chromium
   ```

## Running Tests

### Basic Commands

```bash
# Run all E2E tests
pnpm run test:e2e
# or
task test-e2e

# Run with UI mode (recommended for development)
pnpm run test:e2e:ui
# or
task test-e2e-ui

# Run in debug mode (step through tests)
pnpm run test:e2e:debug
# or
task test-e2e-debug

# Run with visible browser
pnpm run test:e2e:headed
# or
task test-e2e-headed

# Run all tests (unit + E2E)
pnpm run test:all
# or
task test-all
```

### Running Specific Tests

```bash
# Run a specific test file
npx playwright test e2e/popup-login.spec.ts

# Run tests matching a pattern
npx playwright test --grep "login"

# Run a single test
npx playwright test e2e/popup-login.spec.ts:10  # line 10
```

The local API, UI, fixture and Stripe adapter output is saved to
`test-results/servers/enx-api.log`, `test-results/servers/enx-ui.log` and
`test-results/servers/fixtures.log`, plus `test-results/servers/stripe.log`. If a server exits during startup, its
last 50 log lines are printed. Set `E2E_SERVER_LOGS=1` to stream server output
instead. Playwright test artifacts are in `test-results/artifacts/`.

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
│   ├── fixtures.ts                    # Custom Playwright fixtures
│   ├── helpers.ts                     # Test helper functions
│   ├── popup-login.spec.ts           # Popup login tests
│   ├── content-highlighting.spec.ts   # Word highlighting tests
│   ├── content-translation.spec.ts    # Translation popup tests
│   └── options-page.spec.ts          # Options page tests
├── playwright.config.ts               # Playwright configuration
└── dist/                              # Built extension (required)
```

### Key Files

#### `playwright.config.ts`

Main Playwright configuration:

- **Test directory**: `./e2e`
- **Browser**: Chromium only (required for Chrome extensions)
- **Headless mode**: `false` (Chrome extensions require visible browser)
- **Workers**: 1 (avoid conflicts when loading extension)
- **Screenshots**: Captured on failure
- **Videos**: Captured on first retry

#### `e2e/fixtures.ts`

Custom Playwright fixtures for Chrome extension testing:

```typescript
export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    // Loads extension from dist/ directory
    const pathToExtension = path.join(__dirname, '../dist')
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    })
    await use(context)
  },
  extensionId: async ({ context }, use) => {
    // Extracts extension ID from service worker URL
    let [background] = context.serviceWorkers()
    if (!background) background = await context.waitForEvent('serviceworker')
    const [, , extensionId] = background.url().split('/')
    await use(extensionId)
  },
})
```

#### `e2e/helpers.ts`

Reusable test utilities:

- `openPopup(page, extensionId)` - Navigate to popup
- `openOptions(page, extensionId)` - Navigate to options page
- `login(page, username, password)` - Perform login
- `enableLearningMode(page, extensionId)` - Enable learning mode
- `waitForContentScript(page)` - Wait for content script injection
- `getHighlightedWordsCount(page)` - Count highlighted words
- `clickWordAndWaitForPopup(page, wordIndex)` - Interact with words
- `clearStorage(page)` - Clear extension storage

## Test Coverage

### 1. Popup Login Tests (`popup-login.spec.ts`)

Tests the popup UI and authentication:

- ✅ Display login form when not logged in
- ✅ Successfully login with valid credentials
- ✅ Show error with invalid credentials
- ✅ Remember login state after popup reopens

### 2. Content Script - Word Highlighting (`content-highlighting.spec.ts`)

Tests word highlighting functionality:

- ✅ Highlight words on BBC News article
- ✅ Not highlight words when learning mode is disabled
- ✅ Add `enx-word` class to highlighted words
- ✅ Work on different websites (Wikipedia, etc.)

### 3. Content Script - Translation (`content-translation.spec.ts`)

Tests translation popup:

- ✅ Show translation popup when clicking highlighted word
- ✅ Popup contains word and translation
- ✅ Close translation popup when clicking outside
- ✅ Show different translations for different words

### 4. Options Page Tests (`options-page.spec.ts`)

Tests options page functionality:

- ✅ Display options page with API configuration
- ✅ Save API URL configuration
- ✅ Show default API URL when no custom URL is set
- ✅ Reset to default URL

## Writing New Tests

### Example Test

```typescript
import { test, expect } from './fixtures'
import { openPopup, login } from './helpers'

test.describe('My Feature', () => {
  test('should do something', async ({ page, extensionId }) => {
    // Open popup
    await openPopup(page, extensionId)

    // Perform login
    await login(page, 'wiloon', 'haCahpro')

    // Assert something
    await expect(page.locator('text=/Welcome/')).toBeVisible()
  })
})
```

### Best Practices

1. **Always build first**: E2E tests require `dist/` to exist
2. **Use helpers**: Reuse helper functions from `helpers.ts`
3. **Clear storage**: Use `clearStorage()` in `beforeEach` to avoid state pollution
4. **Wait for elements**: Use `waitForSelector()` instead of `waitForTimeout()`
5. **Use fixtures**: Access `page`, `context`, and `extensionId` from test fixtures
6. **Descriptive names**: Use clear test descriptions
7. **Isolate tests**: Each test should be independent

### Common Patterns

#### Navigate to Extension Pages

```typescript
// Popup
await page.goto(`chrome-extension://${extensionId}/popup.html`)

// Options
await page.goto(`chrome-extension://${extensionId}/options.html`)
```

#### Interact with Content Scripts

```typescript
// Navigate to a website
await page.goto('https://www.bbc.com/news')

// Enable learning mode
await enableLearningMode(page, extensionId)

// Wait for content script
await waitForContentScript(page)

// Check highlighted words
const count = await page.locator('.enx-word').count()
expect(count).toBeGreaterThan(0)
```

#### Check Chrome Storage

```typescript
// Get storage value
const value = await page.evaluate(() => {
  return chrome.storage.local.get('key')
})

// Clear storage
await page.evaluate(() => {
  return chrome.storage.local.clear()
})
```

## Debugging Tests

### Visual Debugging

Use UI mode for interactive debugging:

```bash
pnpm run test:e2e:ui
# or
task test-e2e-ui
```

Features:

- See test execution in real-time
- Inspect DOM at any point
- Time-travel through test steps
- View network requests
- Edit and re-run tests

### Debug Mode

Use debug mode to step through tests:

```bash
pnpm run test:e2e:debug
# or
task test-e2e-debug
```

This will:

- Open Playwright Inspector
- Pause before each action
- Allow stepping through test line by line
- Show element selectors

### Screenshots and Videos

Failed tests automatically capture:

- **Screenshots**: Saved to `test-results/artifacts/`
- **Videos**: Saved to `test-results/artifacts/` (on retry)

To view:

```bash
# View test results
npx playwright show-report

# Open specific test artifacts
open test-results/artifacts/popup-login-should-display-login-form/test-failed-1.png
```

## Troubleshooting

### Extension Not Loading

**Problem**: Tests fail because extension is not loaded

**Solution**:

```bash
# Build extension first
pnpm run build
# or
task build

# Then run tests
pnpm run test:e2e
```

### Service Worker Not Ready

**Problem**: `Cannot read properties of undefined (reading 'url')`

**Solution**: The fixture already handles this with `waitForEvent('serviceworker')`. If it still fails:

```typescript
// Wait longer for service worker
await page.waitForTimeout(2000)
```

### Popup Not Opening

**Problem**: Popup page is blank or not loading

**Solution**:

1. Check that popup.html exists in `dist/`
2. Verify manifest.json has correct popup path
3. Check browser console for errors

### Content Script Not Injecting

**Problem**: Words not highlighting, content script errors

**Solution**:

1. Check manifest.json `matches` patterns
2. Verify content.ts is in `dist/`
3. Use `waitForContentScript()` helper
4. Check website CSP (Content Security Policy)

### Tests Timeout

**Problem**: Tests timeout waiting for elements

**Solution**:

1. Increase timeout: `{ timeout: 10000 }`
2. Check element selector is correct
3. Verify element actually appears
4. Use `waitForLoadState('domcontentloaded')`

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Build extension
        run: pnpm run build

      - name: Run E2E tests
        run: pnpm run test:e2e

      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-results
          path: test-results/
```

## Performance Tips

1. **Use single worker**: Chrome extensions can conflict with multiple workers
2. **Reuse context**: The fixture automatically reuses browser context
3. **Parallel tests**: Use `test.describe.parallel()` for independent test suites
4. **Skip unnecessary waits**: Use `waitForSelector()` instead of `waitForTimeout()`
5. **Build once**: Build extension before running all tests, not between tests

## Local Testing with Static Pages

To avoid dependency on external websites (BBC, InfoQ, etc.) and improve test reliability, we use local static HTML pages served by `http-server`:

### Local Test Server

- **Auto-start**: Playwright config automatically starts `http-server` on port 8080
- **Test fixtures**: Located in `e2e/test-fixtures/`
  - `test-page.html` - Software development article (~200 words)
  - `typescript-page.html` - TypeScript introduction article
- **Base URL**: `http://localhost:8080` (configured in `playwright.config.ts`)

### Benefits

- ✅ Faster test execution (no network latency)
- ✅ More reliable (no external site downtime)
- ✅ Offline testing (no internet required)
- ✅ Consistent content (test pages don't change)
- ✅ Easier debugging (can modify test pages locally)

## Known Limitations

### API-Dependent Features

Some tests require a running backend API (default: `http://localhost:8090/enx/api/`):

- **Translation popup tests**: Currently fail without API because word translation requires backend
- **Word color coding**: Without API, all words show white underline (#FFFFFF)
- **Word database lookups**: LoadCount and WordType data come from API

**Current Test Results** (without API):

- ✅ **12 / 16 tests passing** (75%)
- ✅ Popup login tests: 4/4 passing
- ✅ Options page tests: 4/4 passing
- ✅ Content highlighting tests: 4/4 passing
- ❌ Content translation tests: 0/4 passing (need API)

### Running with Full API Support

**Automatic Backend Startup** (Recommended):

Playwright is configured to automatically start and stop the `enx-api` backend server:

```bash
# Just run tests - backend starts automatically
task test-e2e
```

The backend will:

- ✅ Auto-start before tests begin
- ✅ Auto-stop after tests complete
- ✅ Reuse existing server if already running (for faster iteration)

**Manual Backend Startup** (Alternative):

If you prefer to manage the backend manually:

1. Start the `enx-api` backend server:

   ```bash
   cd ../enx-api
   task run  # or task dev
   ```

2. Ensure API is accessible at `http://localhost:8090/api/version`

3. Run tests:

   ```bash
   task test-e2e
   ```

**Note**: Translation and dictionary tests require `ECDICT_DB_PATH` (or `[ecdict] db_path` in `enx-api/config.toml`) pointing to a local ECDICT SQLite database. If ECDICT is not configured, the API returns HTTP 503 for word lookups that need it.

With backend running and ECDICT configured, translation E2E tests can run against the local API.

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

`ai-word-and-credits.spec.ts` needs `ECDICT_DB_PATH`: only a clean
dictionary miss offers the AI fallback, and without ECDICT a missing word
answers 503. With Clerk credentials set and `ECDICT_DB_PATH` unset, these
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
ECDICT_DB_PATH="$HOME/.local/share/enx/ecdict/stardict.db" \
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

The first lookup needs the real read-only ECDICT file. After loading the Clerk
development credentials and building `dist-e2e`, run:

```bash
ECDICT_DB_PATH="$HOME/.local/share/enx/ecdict/stardict.db" \
  pnpm test:e2e new-user-welcome.spec.ts --repeat-each=3
```

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
