# AI Contributions History

This document records significant contributions made with AI assistance.

## 2025-11-12: Separated Unit Tests and Integration Tests

**Agent**: GitHub Copilot
**Task**: Separate unit tests from integration tests to improve test speed and clarity

**Problem**:
- All tests were running as "unit tests" but many required database and config
- Slow test execution (~10 seconds) because of database setup
- No clear distinction between pure unit tests and integration tests
- Tests failed with "no such table" and "config not found" errors

**Solution**:
Implemented proper test separation using Go build tags:

**Changes**:

1. **Created Integration Test Files**:
   - `enx/ecp_integration_test.go` - Database-dependent word tests
   - Added `//go:build integration` tags to:
     - `paragraph/paragraph_test.go`
     - `repo/repo_test.go`
     - `youdao/youdao_test.go`

2. **Cleaned Up Unit Test Files**:
   - `enx/ecp_test.go` - Now contains only pure logic tests
   - Removed database initialization from `init()`
   - Removed unnecessary `fmt.Print()` statements

3. **Updated Task Commands**:
   - Root `Taskfile.yml`:
     - `task test` / `task test-unit` - Fast unit tests only
     - `task test-integration` - Integration tests with DB setup
     - `task test-all` - Both types
   - `enx-api/Taskfile.yml`:
     - `task test` - Unit tests only
     - `task test-integration` - Integration tests with auto-setup
     - `task test-all` - Both types

4. **Created Documentation**:
   - `enx-api/TESTING.md` - Complete testing guide with:
     - Test type definitions
     - How to run different test types
     - Best practices
     - Troubleshooting guide
     - Examples for adding new tests

**Benefits**:
- ✅ **10x faster feedback** - Unit tests run in ~1 second vs ~10 seconds
- ✅ **No database required** - Unit tests work without any setup
- ✅ **Clear separation** - Easy to understand which tests need what dependencies
- ✅ **Better CI/CD** - Can run fast tests first, then integration tests
- ✅ **Proper testing** - Unit tests are truly unit tests now

**Test Results**:
```bash
# Unit tests (fast)
task test-unit
✅ enx-api: 0.021s
✅ enx/ecp_test.go: 4 tests pass
✅ version/version_test.go: 2 tests pass
✅ No database/config needed

# Integration tests (with setup)
task test-integration
✅ Auto-creates enx.db from enx.sql
✅ Auto-copies config-e2e.toml to config.toml
✅ Runs tests with -tags=integration
```

**Commands**:
```bash
# Development (fast)
task test              # Unit tests only (~1s)

# Full validation
task test-integration  # Integration tests (~10s)
task test-all          # Everything

# Individual projects
cd enx-api && task test
cd enx-api && task test-integration
```

**Update**: Added enx-ui unit tests and fixed test-ui task to skip gracefully when dependencies are missing.

---

## 2025-11-12: Fixed enx-ui Testing and Added Unit Tests

**Agent**: GitHub Copilot
**Task**: Install enx-ui dependencies and add unit tests

**Problem**:
- enx-ui had no `node_modules` installed, causing `task test` to fail
- No test files existed for enx-ui
- Test command didn't handle missing dependencies gracefully

**Solution**:

1. **Installed Dependencies**:
   - Ran `pnpm install` in enx-ui directory
   - Installed 782 packages including Jest and testing libraries

2. **Added Unit Tests**:
   - Created `src/lib/__tests__/utils.test.ts`
   - Added 6 test cases for the `cn()` utility function:
     - Basic class name merging
     - Conditional classes
     - Tailwind class deduplication
     - Empty input handling
     - Null/undefined handling
     - Complex class combinations

3. **Improved Task Handling**:
   - Modified `test-ui` task in root `Taskfile.yml`
   - Now checks for `node_modules` before running tests
   - Skips gracefully with friendly message if dependencies missing

**Test Results**:
```bash
✅ enx-api: 6 packages - all unit tests pass
✅ enx-chrome: 4 test suites (27 tests) - all pass
✅ enx-ui: 1 test suite (6 tests) - all pass
```

**Benefits**:
- ✅ All three projects now have working unit tests
- ✅ `task test` runs successfully for all projects
- ✅ Friendly error handling for missing dependencies
- ✅ Complete test coverage infrastructure in place

---

## 2025-11-10: Development Environment Setup with Root Taskfile

**Agent**: GitHub Copilot
**Task**: Create unified development environment with one-command startup

**Changes**:

1. **Root-level Taskfile** (`Taskfile.yml`)
   - Created unified task interface for entire monorepo
   - Delegates to sub-project Taskfiles (enx-api, enx-chrome, enx-ui)
   - Provides `task dev-all` for one-command development startup

2. **One-Command Development Mode** (`task dev-all`)
   - Automatically creates log directories (`enx-api/logs`, `enx-chrome/logs`)
   - Builds Chrome extension on first run
   - Starts enx-api in background with hot reload
   - Starts Chrome extension watch mode in background
   - Installs Playwright browsers if needed
   - Opens Chrome with extension pre-loaded
   - Navigates to target URL (default: InfoQ)

3. **Environment Configuration** (`enx-chrome/.env`)
   - Created `.env` file with `VITE_ENV=development`
   - Configures extension to use local API (`http://localhost:8090`)
   - Documented alternative configurations (staging, production)

4. **Chrome Extension Auto-Loading** (`enx-chrome/dev-chrome.mjs`)
   - Fixed service worker timeout issues
   - Pre-configures Chrome preferences to enable developer mode
   - Automatically pins extension to toolbar
   - Opens `chrome://extensions` first to ensure proper loading
   - Improved error handling and user feedback

5. **Password Reset Tool** (`enx-api/reset_pw.go`)
   - Documented usage for resetting user passwords
   - Generates Argon2id password hash
   - Outputs SQL UPDATE statement for database

**Database Information**:
- **Type**: SQLite3
- **Location**: `enx-api/enx.db`
- **Password Reset**:
  ```bash
  cd enx-api
  go run reset_pw.go  # Generates hash for 'haCahpro'
  sqlite3 enx.db "UPDATE users SET password = '<hash>' WHERE name = 'wiloon';"
  ```

**Log Directory Structure**:
```
enx/
├── enx-api/
│   └── logs/
│       └── dev.log          # API development logs
├── enx-chrome/
│   └── logs/
│       └── watch.log        # Chrome watch mode logs
```

**Key Commands**:
```bash
# Start complete development environment
task dev-all

# With custom URL
task dev-all URL=https://www.bbc.com/news

# Stop all services
task stop-dev

# View logs
task dev-logs
tail -f enx-api/logs/dev.log
tail -f enx-chrome/logs/watch.log
```

**Benefits**:
- ✅ **Zero-config startup** - Single command starts everything
- ✅ **Auto-reload** - API and extension auto-reload on code changes
- ✅ **Proper logging** - All logs organized in project directories
- ✅ **Developer mode** - Chrome extension automatically configured
- ✅ **Correct API URL** - Extension uses local API by default

---

## 2025-11-09: Cursor UX Improvement for Word Highlighting

**Agent**: GitHub Copilot
**Task**: Improve cursor styling UX for highlighted words in learning mode

**Problem**: All highlighted words showed `cursor: pointer` (hand cursor) at all times, making the entire page feel overly clickable and reducing readability:

- Every highlighted word looked like a clickable button
- Hand cursor everywhere disrupted natural reading flow
- No visual distinction between hovering and not hovering
- Felt like "too much interactivity" on every word

**Solution**: Implemented hover-based cursor styling with smooth transitions:

- Default: Normal text cursor (`cursor: text`) for natural reading flow
- On hover: Hand cursor (`cursor: pointer`) + opacity change for clear feedback
- Smooth 0.15s transition for polished UX
- Removed inline cursor styles, added global CSS with `:hover` selector

**Changes**:

- Modified `src/content/content.ts`:
  - Removed `cursor: pointer;` from inline word highlighting styles (line 181)
  - Added global CSS for `.enx-word` with hover-based cursor behavior
  - CSS includes smooth transition and opacity feedback on hover
- Updated tests to match new behavior:
  - `src/content/__tests__/wordHighlighting.test.ts`
  - `src/content/__tests__/highlightingIntegration.test.ts`
  - Changed assertions from `.toContain('cursor: pointer')` to `.not.toContain('cursor: pointer')`
- Created `CURSOR_UX_IMPROVEMENT.md` documentation with detailed comparison diagrams

**Benefits**:

- ✅ **Better reading experience** - Text cursor by default maintains natural flow
- ✅ **Clear hover feedback** - Hand cursor only appears when hovering over words
- ✅ **Reduced visual noise** - Page feels less cluttered and more professional
- ✅ **Smooth transitions** - Polished interaction with opacity and cursor changes
- ✅ **All tests passing** - 26/26 unit tests pass with updated behavior

**Technical Details**:

```css
.enx-word {
  cursor: text;              /* Default: Normal text cursor */
  transition: all 0.15s ease; /* Smooth transition */
}

.enx-word:hover {
  cursor: pointer;            /* Only show hand cursor on hover */
  opacity: 0.8;              /* Visual feedback */
}
```

---

## 2025-11-09: Chrome Auto-Reload Development Mode

**Agent**: GitHub Copilot
**Task**: Add `task dev-chrome` command for automatic extension reloading during development

**Problem**: Manual Chrome extension reload workflow was slow and repetitive:

- `task watch` auto-rebuilds code, but doesn't reload extension
- User must manually click reload in `chrome://extensions/` after each rebuild
- Chrome security policy prevents external processes from reloading extensions in user's personal Chrome

**Solution**: Launch dedicated Chrome instance with extension pre-loaded (similar to E2E tests):

- Chrome instance automatically detects changes in `dist/` and reloads extension
- Uses separate user data directory (`/tmp/chrome-dev-enx`)
- Supports custom URL parameter for testing different websites
- Same technique as Playwright E2E tests (Chrome launched with `--load-extension` flag)

**Changes**:

- Added `task dev-chrome` command to `Taskfile.yml`:
  - Launches Chrome with extension pre-loaded from `dist/`
  - Accepts optional `URL` parameter (defaults to InfoQ)
  - Uses isolated Chrome profile for development
- Created `DEV_CHROME_AUTO_RELOAD.md` documentation:
  - Explains why auto-reload works with dedicated Chrome instance
  - Complete workflow guide for combined `task watch` + `task dev-chrome`
  - Troubleshooting tips for different operating systems
  - Comparison with other development methods
- Updated `README.md` with new development workflow option

**Usage**:

```bash
# Terminal 1: Auto-rebuild on file changes
task watch

# Terminal 2: Launch Chrome with extension loaded
task dev-chrome

# Or with custom URL:
task dev-chrome URL=https://www.bbc.com/news
```

**Benefits**:

- ✅ **Zero manual reloads** - Extension auto-reloads on code changes
- ✅ **Fast iteration** - Edit code and see changes immediately
- ✅ **Multiple instances** - Test on different URLs simultaneously
- ✅ **Isolated environment** - Won't interfere with personal Chrome browsing
- ✅ **Same as E2E** - Uses proven technique from Playwright tests

**Technical Details**:

```bash
google-chrome \
  --load-extension=$(pwd)/dist \
  --disable-extensions-except=$(pwd)/dist \
  --user-data-dir=/tmp/chrome-dev-enx \
  "https://www.infoq.com/"
```

---

## 2025-11-08: Automatic Backend Management for E2E Tests

**Agent**: GitHub Copilot
**Task**: Configure Playwright to automatically start and stop `enx-api` backend during E2E tests

**Problem**: Users had to manually start the `enx-api` backend server before running E2E tests, leading to:

- Extra manual steps in the testing workflow
- Forgotten backend startup causing confusing test failures
- Inconsistent test environments

**Changes**:

- Updated `playwright.config.ts` to manage multiple web servers:
  - Backend API server (`enx-api` on port 8090)
  - Frontend test fixtures server (`http-server` on port 8080)
- Configured health check endpoint: `http://localhost:8090/api/version`
- Set appropriate timeout (30s) for Go backend startup
- Enabled server reuse for faster iteration during development

**Configuration**:

```typescript
webServer: [
  {
    // Backend API server (enx-api)
    command: 'cd ../enx-api && go run .',
    url: 'http://localhost:8090/api/version',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  {
    // Frontend test fixtures server
    command: 'npx http-server e2e/test-fixtures -p 8080 --silent',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
]
```

**Benefits**:

- ✅ **Zero-config testing** - Just run `task test-e2e`, backend starts automatically
- ✅ **Automatic cleanup** - Backend stops after tests complete
- ✅ **Faster iteration** - Reuses existing server in development mode
- ✅ **Consistent environment** - Same backend setup for all developers
- ✅ **CI/CD ready** - Works in automated pipelines without manual setup

**Test Results**:

- **12 / 16 tests passing** with auto-started backend
- Backend successfully starts and responds within 30s timeout
- All non-translation tests pass (translation requires additional API keys)

**Updated Documentation**:

- Added "Automatic Backend Startup" section to `E2E_TESTING.md`
- Documented manual startup as alternative approach
- Clarified that translation tests require third-party API configuration

---

## 2025-11-08: E2E Testing Local Test Pages & enableLearningMode Fix

**Agent**: GitHub Copilot
**Task**: Implement local test pages and fix Content Script activation for E2E tests

**Problem**: E2E tests were using external websites (BBC, InfoQ, Wikipedia) which were slow, unreliable, and had CORS/network issues. Additionally, `enableLearningMode` helper wasn't working in Playwright environment due to Chrome's "active tab" API limitations.

**Changes**:

- Added `http-server@14.1.1` as dev dependency for serving local test fixtures
- Created local test HTML pages in `e2e/test-fixtures/`:
  - `test-page.html` - Software development article (~200 words)
  - `typescript-page.html` - TypeScript introduction article
- Updated `playwright.config.ts` to auto-start `http-server` on port 8080
- Fixed `enableLearningMode` helper to work around Playwright's tab management:
  - Old approach: Opened popup and clicked "Enable Learning Mode" button (failed due to "active tab" query)
  - New approach: Opens popup in extension context, uses `chrome.tabs.query({})` to find target tab by URL, sends `enxRun` message directly to that tab's content script
- Updated all content script tests to use `localhost:8080` test pages
- Updated `manifest.json` to allow Content Script injection on localhost:
  - Added `"http://localhost:*/*"` and `"http://127.0.0.1:*/*"` to `matches` array
- Updated `E2E_TESTING.md` with:
  - Local testing setup documentation
  - Known limitations (API-dependent features)
  - Current test results (12/16 passing without API)
  - Instructions for running with full API support

**Root Cause Analysis**:

1. **Content Script Loading**: Content Script **was** loading correctly on localhost, confirmed by console message: `ENX Content script loaded`
2. **The Real Issue**: `chrome.tabs.query({ active: true, currentWindow: true })` in popup doesn't return the correct tab in Playwright environment
3. **Solution**: Bypass the "active tab" limitation by querying all tabs and finding by URL

**Test Results**:

- ✅ **12 / 16 tests passing** (75% success rate without API)
- ✅ Popup login tests: 4/4 passing
- ✅ Options page tests: 4/4 passing
- ✅ Content highlighting tests: 4/4 passing
- ❌ Content translation tests: 0/4 failing (require backend API for translation data)

**Key Improvements**:

- ✅ **Local test pages** - Fast, reliable, offline-capable testing
- ✅ **Fixed enableLearningMode** - Works correctly in Playwright environment
- ✅ **150 words highlighted** - Content Script successfully processes test page
- ✅ **No external dependencies** - Tests don't rely on external websites
- ⚠️ **API needed for translation** - 4 translation tests require running `enx-api` backend

**Benefits**:

- Faster test execution (no network latency)
- More reliable (no external site downtime)
- Offline testing capability
- Easier debugging (can modify test pages locally)
- Better understanding of Content Script lifecycle
- Clear documentation of API requirements

**Technical Details**:

```typescript
// Fixed enableLearningMode helper
export async function enableLearningMode(page: Page, extensionId: string) {
  const targetUrl = page.url()

  // Open popup to execute chrome.tabs API (only available in extension contexts)
  const popupPage = await page.context().newPage()
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`)

  // Find target tab by URL and send message directly
  const result = await popupPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({})
    const targetTab = tabs.find(tab => tab.url === url)
    if (!targetTab?.id) return { success: false, error: 'Tab not found' }

    return await chrome.tabs.sendMessage(targetTab.id, { action: 'enxRun' })
  }, targetUrl)

  await popupPage.close()
  if (!result?.success) throw new Error(`Failed: ${result?.error}`)
}
```

---

## 2025-11-02: E2E Testing with Playwright for enx-chrome

**Agent**: GitHub Copilot
**Task**: Add comprehensive E2E testing infrastructure using Playwright

**Changes**:

- Installed `@playwright/test` v1.56.1 and Chromium browser
- Created `playwright.config.ts` with Chrome extension-specific configuration
- Created `e2e/fixtures.ts` with custom fixtures for extension testing
- Created `e2e/helpers.ts` with reusable test utilities
- Created 4 E2E test suites with 16 test cases:
  - `e2e/popup-login.spec.ts` - Login and authentication tests (4 tests)
  - `e2e/content-highlighting.spec.ts` - Word highlighting tests (4 tests)
  - `e2e/content-translation.spec.ts` - Translation popup tests (4 tests)
  - `e2e/options-page.spec.ts` - Options page configuration tests (4 tests)
- Updated `package.json` with E2E test scripts
- Updated `Taskfile.yml` with E2E testing tasks
- Created comprehensive `E2E_TESTING.md` documentation
- Updated `README.md` with E2E testing section

**Key Features Added**:

- ✅ **Extension Loading** - Custom fixtures load extension from `dist/` directory
- ✅ **Service Worker Extraction** - Automatically extracts extension ID from service worker
- ✅ **Test Helpers** - Reusable utilities for login, navigation, content script interaction
- ✅ **Comprehensive Coverage** - Tests for popup, content scripts, translation, and options
- ✅ **Visual Debugging** - UI mode and debug mode for easy troubleshooting
- ✅ **Artifacts** - Screenshots and videos on test failure

**Test Commands**:

- `task test-e2e` - Run E2E tests
- `task test-e2e-ui` - Run with Playwright UI
- `task test-e2e-debug` - Run in debug mode
- `task test-e2e-headed` - Run with visible browser
- `task test-all` - Run unit + E2E tests

**Benefits**:

- Automated testing of Chrome extension in real browser environment
- Tests cover entire user workflow (login, highlighting, translation, configuration)
- Reduces manual testing effort
- Catches regressions early
- Provides confidence for refactoring and feature additions
- CI/CD ready (with example GitHub Actions workflow)

---

## 2025-11-02: Auto-reload Setup with @crxjs/vite-plugin

**Agent**: GitHub Copilot
**Task**: Add automatic extension reloading for Chrome extension development

**Changes**:

- Installed `@crxjs/vite-plugin` for automatic hot reload
- Simplified `vite.config.ts` by removing custom manifest handling
- Updated `manifest.json` to use source file paths (TypeScript)
- Updated `TASKFILE_README.md` with auto-reload documentation

**Key Improvements**:

- ✅ **True hot reload** - Extension auto-reloads in Chrome when code changes
- ✅ **Simplified config** - Removed 50+ lines of custom build logic
- ✅ **Better DX** - No more manual extension refresh in most cases
- ✅ **Automatic handling** - Icons, manifest, and assets automatically processed

**Benefits**:

- Significantly faster development iteration
- No need to manually click reload button in chrome://extensions
- Automatic manifest.json synchronization
- Better error messages during development

---

## 2025-11-02: Taskfile Setup for enx-chrome

**Agent**: GitHub Copilot
**Task**: Add Taskfile for Chrome extension development

**Changes**:

- Created `enx-chrome/Taskfile.yml` with comprehensive task definitions
- Created `enx-chrome/TASKFILE_README.md` with usage documentation

**Key Features Added**:

- `task dev` - Start development server with hot reload
- `task build` - Build extension for production
- `task pack` - Create distributable zip for Chrome Web Store
- `task test` - Run tests
- `task lint` - Lint code
- `task format` - Format code with Prettier
- `task check` - Run all checks (lint, format, test)
- `task setup` - Complete setup (install + build)
- `task reload` - Rebuild and remind to reload extension
- `task open-chrome` - Open Chrome extensions page
- `task ci` - Complete CI/CD workflow

**Benefits**:

- Consistent task interface across all projects (enx-api, enx-chrome)
- Simplified development workflow for Chrome extension
- Easy packaging for Chrome Web Store distribution
- Better development experience with hot reload

---

## 2025-11-02: Taskfile Setup for enx-api

**Agent**: GitHub Copilot
**Task**: Add Taskfile for local non-container development

**Changes**:

- Created `enx-api/Taskfile.yml` with comprehensive task definitions
- Created `enx-api/.air.toml` for hot reload configuration
- Created `enx-api/TASKFILE_README.md` with usage documentation
- Fixed port binding error handling in `enx-api/enx-api.go`
- Updated `.gitignore` to exclude build artifacts and temporary files

**Key Features Added**:

- `task run` - Run application locally using `go run`
- `task dev` - Hot reload development mode with Air
- `task build` - Production build with version information
- `task build-dev` - Development build without version injection
- `task test` - Run tests
- `task test-coverage` - Run tests with coverage report
- `task fmt` - Format code
- `task vet` - Run go vet
- `task lint` - Run linters
- `task clean` - Clean build artifacts
- `task version` - Show version information
- `task deps` - Download dependencies
- `task migrate` - Run database migrations

**Files Modified**:

- `enx-api/enx-api.go` - Added proper error handling for port binding failures
- `.gitignore` - Added Air temporary files, coverage reports, and binary outputs

**Benefits**:

- Simplified local development workflow
- Hot reload for faster iteration
- Consistent task execution across team
- Better error handling when port is already in use
