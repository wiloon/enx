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

- **Screenshots**: Saved to `test-results/`
- **Videos**: Saved to `test-results/` (on retry)

To view:

```bash
# View test results
npx playwright show-report

# Open specific test artifacts
open test-results/popup-login-should-display-login-form/test-failed-1.png
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

**Note**: Translation tests still require third-party translation API configuration (Youdao, etc.) in `enx-api/config.toml`.

With backend running, **12/16 tests pass**. Translation tests require additional configuration.

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Testing Chrome Extensions](https://playwright.dev/docs/chrome-extensions)
- [Debugging Tests](https://playwright.dev/docs/debug)
- [Best Practices](https://playwright.dev/docs/best-practices)
