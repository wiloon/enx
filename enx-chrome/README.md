# Enx Chrome Extension

A modern Chrome extension for English learning that helps you learn vocabulary while browsing the web. Built with React, TypeScript, and Jotai for state management.

## Features

- 🎯 **Smart Word Highlighting** - Automatically highlights English words on web pages with color-coded difficulty levels
- 💬 **Instant Translation** - Click any highlighted word to see its translation and definition
- 📊 **Learning Progress** - Track your vocabulary learning progress with visual indicators
- 🔄 **Seamless Integration** - Works on most websites without disrupting your browsing experience
- 🌐 **Multi-site Support** - Optimized for popular news and learning websites

## Supported Websites

### ✅ Fully Tested & Optimized

The following websites have been thoroughly tested and provide excellent learning experience:

- **[BBC News](https://www.bbc.com)** - High-quality English news articles
- **[InfoQ](https://www.infoq.com)** - Technology and software development content
- **[NY Times Newsletters](https://messaging-custom-newsletters.nytimes.com/)** - Premium news content
- **[Tingroom Novels](https://novel.tingroom.com)** - English literature and novels
- **[Wiloon.com](https://wiloon.com)** - Personal blog and articles

### 🌍 General Support

The extension now supports **all HTTP/HTTPS websites** with the following exceptions:

- ❌ Chrome internal pages (`chrome://`, `chrome-extension://`)
- ❌ Chrome Web Store pages

**Note**: While the extension works on most websites, some sites with dynamic content or special security policies may have limited functionality.

## Tech Stack

- **React** - UI framework
- **TypeScript** - Type safety
- **Jotai** - State management
- **Vite** - Build tool with @crxjs/vite-plugin for hot reload
- **Tailwind CSS** - Styling
- **Jest + Testing Library** - Testing
- **ESLint + Prettier** - Code quality
- **Sentry** - Error monitoring
- **pnpm** - Fast, disk space efficient package manager

## Getting Started

### Prerequisites

- Node.js 16+
- pnpm (recommended) or npm
- Chrome browser

### Installation

Install dependencies:

```bash
pnpm install
```

Set up environment variables:

```bash
cp .env.example .env
# Edit .env and configure:
# - VITE_ENV=development (for local API)
# - VITE_SENTRY_DSN=your_sentry_dsn (optional)
```

### Development

**Option 1: Watch mode with auto-reload Chrome** (recommended):

```bash
# Terminal 1: Auto-rebuild on file changes
task watch

# Terminal 2: Start Chrome with extension loaded
task dev-chrome

# Or open a specific URL:
task dev-chrome URL=https://www.infoq.com/

# The extension will auto-reload in Chrome when files change!
```

**Option 2: Watch mode + manual Chrome reload**:

```bash
# Auto-rebuild on file changes
task watch

# Then reload extension in chrome://extensions/ after each rebuild
```

**Option 3: Vite dev server** (may have issues):

```bash
# Vite dev server with hot reload
task dev
# ⚠️  Note: May show "cannot connect to vite server" and flashing popup
# If this happens, use one of the options above
```

The `task dev-chrome` command starts a Chrome instance with the extension pre-loaded. When you rebuild (with `task watch`), the extension automatically reloads in that Chrome window. This is similar to how E2E tests work, but for manual testing.

### Building

Build for local development (uses `localhost:8090` API):

```bash
task build-dev
# or
task build
```

Build for production:

```bash
pnpm run build
# or use Taskfile
task build
```

### Loading the Extension in Chrome

1. Build the extension: `pnpm run build` or `task build`
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked" and select the `dist` folder
5. The extension icon should appear in your Chrome toolbar

## Usage

### 1. Login

1. Click the extension icon in Chrome toolbar
2. Enter your username and password
3. Click "Login"

### 2. Enable Learning Mode

1. Navigate to any supported website (see list above)
2. Click the extension icon
3. Click "Enable Learning Mode" button
4. Wait for the processing to complete (button will show "Completed!" ✓)

### 3. Learn Vocabulary

- **Browse** - Words will be highlighted with colored underlines
- **Click** - Click any highlighted word to see translation and definition
- **Track** - Color intensity indicates how many times you've encountered the word

### Color Coding

- 🟢 **Green** - New words (seen 1-10 times)
- 🟡 **Yellow** - Familiar words (seen 10-20 times)
- 🟠 **Orange** - Well-known words (seen 20-30 times)
- 🔴 **Red** - Mastered words (seen 30+ times)

## Scripts

### Using pnpm

- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production
- `pnpm run preview` - Preview production build
- `pnpm run test` - Run tests
- `pnpm run test:watch` - Run tests in watch mode
- `pnpm run lint` - Lint code
- `pnpm run lint:fix` - Fix linting issues
- `pnpm run format` - Format code
- `pnpm run format:check` - Check code formatting

### Using Taskfile

For detailed task documentation, see [TASKFILE_README.md](./TASKFILE_README.md)

- `task dev` - Start development server with hot reload
- `task build` - Build extension for production
- `task test` - Run tests
- `task lint` - Lint code
- `task format` - Format code
- `task clean` - Clean build artifacts

## Configuration

### API Endpoints

The extension supports multiple environments:

- **Development**: `http://localhost:8090` (default when `VITE_ENV=development`)
- **Staging**: `https://enx-dev.wiloon.com`
- **Production**: `https://enx.wiloon.com`

You can change the API endpoint in the extension's Options page:

1. Right-click extension icon → Options
2. Select or enter your desired API URL
3. Click "Save"

For more details, see [API_CONFIG_README.md](./API_CONFIG_README.md)

## Extension Structure

- `src/popup/` - Popup UI components (login, controls)
- `src/options/` - Options page components (settings, API configuration)
- `src/background/` - Background service worker (session management)
- `src/content/` - Content script (word highlighting, translation popup)
- `src/components/` - Shared React components
- `src/store/` - Jotai atoms for state management
- `src/services/` - API services and utilities
- `src/lib/` - Utility functions and configurations
- `src/hooks/` - Custom React hooks
- `src/types/` - TypeScript type definitions

## Testing

### Unit Tests

Run Jest unit tests:

```bash
pnpm run test
# or use Taskfile
task test
```

The unit test setup includes:

- Jest configuration for TypeScript with `react-jsx` transform
- Testing Library for React components
- Mock Chrome APIs for extension testing
- Coverage reporting

### E2E Tests

Run Playwright E2E tests:

```bash
# Build extension first (required for E2E tests)
pnpm run build
# or
task build

# Run E2E tests
pnpm run test:e2e
# or
task test-e2e

# Run with UI mode (recommended for development)
pnpm run test:e2e:ui
# or
task test-e2e-ui

# Run in debug mode
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

The E2E test setup includes:

- Playwright with Chromium browser automation
- Custom fixtures for Chrome extension testing
- Extension loading from `dist/` directory
- Tests for popup, content scripts, translation, and options page

**Important Notes**:

- ⚠️ **Always build extension first**: E2E tests require a built extension in `dist/`
- 🎯 **Tests run in visible browser**: Chrome extensions require `headless: false`
- 📝 **Test files**: Located in `e2e/` directory
- 🔧 **Configuration**: See `playwright.config.ts`

E2E Test Coverage:

- **Popup Login** (`e2e/popup-login.spec.ts`):
  - Login form display
  - Successful authentication
  - Error handling for invalid credentials
  - Login state persistence

- **Content Script - Word Highlighting** (`e2e/content-highlighting.spec.ts`):
  - Word highlighting on BBC News
  - Learning mode toggle
  - CSS class application
  - Multi-site support

- **Content Script - Translation** (`e2e/content-translation.spec.ts`):
  - Translation popup display
  - Word and translation content
  - Popup close behavior
  - Different words show different translations

- **Options Page** (`e2e/options-page.spec.ts`):
  - API configuration UI
  - Save custom API URL
  - Default URL display
  - Reset to default functionality

## Troubleshooting

### Enable Learning Mode Not Working

If clicking "Enable Learning Mode" has no effect:

1. **Reload the extension**:
   - Go to `chrome://extensions`
   - Find ENX extension
   - Click the refresh button 🔄

2. **Check the website**:
   - Works best on [supported websites](#supported-websites)
   - Chrome internal pages (`chrome://`) are not supported

3. **Verify content script loaded**:
   - Open browser console (F12)
   - Refresh the page
   - Should see: `ENX Content script loaded`

4. **Check for errors**:
   - Right-click Popup → Inspect
   - Check console for error messages

For more details, see [ENABLE_LEARNING_MODE_FIX.md](./ENABLE_LEARNING_MODE_FIX.md)

### API Connection Issues

If you can't connect to the API:

1. **Verify API URL**:
   - Right-click extension icon → Options
   - Check "Current Environment" section
   - Ensure correct API URL is configured

2. **For local development**:
   - Ensure `.env` has `VITE_ENV=development`
   - Start local API server on port 8090
   - Clear Chrome Storage if needed (see [QUICK_FIX.md](./QUICK_FIX.md))

3. **Test API connection**:
   - Open `chrome-extension://YOUR_ID/config-check.html`
   - Click "Refresh Configuration"
   - Verify API URL is correct

For more details, see [API_CONFIG_README.md](./API_CONFIG_README.md)

### Test Page

Use the built-in test page to verify functionality:

```text
chrome-extension://YOUR_EXTENSION_ID/test-page.html
```

Or save this as an HTML file and open it in Chrome.

## Development Notes

- **Manifest V3**: Uses the latest Chrome extension manifest version
- **Watch Mode Recommended**: Use `task watch` for local development instead of `task dev`
  - `task dev` starts Vite dev server but may cause "cannot connect to vite server" errors
  - `task watch` auto-rebuilds to `dist/` on file changes (requires manual extension reload)
- **Sentry Integration**: Error monitoring (configure DSN in `.env`)
- **Tailwind CSS**: Utility-first CSS framework with modern design system
- **Jotai**: Lightweight state management with Chrome Storage persistence
- **TypeScript**: Full type safety across the codebase
- **Content Script**: Automatically injected on all HTTP/HTTPS websites (excluding Chrome internal pages)

### Known Issues

**Vite Dev Server with Chrome Extensions**:
- Symptom: Popup shows "cannot connect to vite server" and keeps flashing
- Cause: `@crxjs/vite-plugin` dev server connection issues with Chrome extension security policies
- Solution: Use `task watch` instead of `task dev` for local development

## Project Documentation

- [TASKFILE_README.md](./TASKFILE_README.md) - Task runner documentation
- [API_CONFIG_README.md](./API_CONFIG_README.md) - API configuration guide
- [QUICK_FIX.md](./QUICK_FIX.md) - Quick fix for API connection issues
- [ENABLE_LEARNING_MODE_FIX.md](./ENABLE_LEARNING_MODE_FIX.md) - Learning mode troubleshooting
- [AGENTS.md](./AGENTS.md) - AI agent contributions and guidelines

## Contributing

1. Follow the existing code style (enforced by ESLint + Prettier)
2. Add tests for new features
3. Run `task check` before committing (lint + format + test)
4. Update documentation as needed
5. Use English for all code, comments, and documentation

## License

See [LICENSE](./LICENSE) file for details.
