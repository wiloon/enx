# Chrome Auto-Reload Development Mode

## Overview

The `task dev-chrome` command starts a Chrome instance with the ENX extension pre-loaded. When combined with `task watch`, you get **automatic extension reloading** on code changes - similar to how E2E tests work, but for manual testing!

## Why This Works

### The Problem
- **User-managed Chrome**: Chrome security policy prevents external processes from reloading extensions in your personal Chrome browser
- **Manual reload needed**: After rebuilding, you have to manually click reload in `chrome://extensions/`

### The Solution
- **Dedicated Chrome instance**: `task dev-chrome` starts a **new Chrome process** with its own user data directory
- **Extension auto-reload**: This Chrome instance automatically reloads the extension when files in `dist/` change
- **Similar to E2E testing**: Uses the same technique as Playwright E2E tests - launching Chrome with `--load-extension` flag

## Usage

### Basic Workflow

**Terminal 1** - Watch mode (auto-rebuild):
```bash
cd enx-chrome
task watch
```

**Terminal 2** - Launch Chrome with extension:
```bash
cd enx-chrome
task dev-chrome
```

**Result**: Edit code → Vite auto-rebuilds → Extension auto-reloads in Chrome!

### Custom URL

Open a specific website:
```bash
task dev-chrome URL=https://www.bbc.com/news
task dev-chrome URL=http://localhost:3000
```

Default URL: `https://www.infoq.com/`

## How It Works

### Technical Details

The `task dev-chrome` command runs:
```bash
google-chrome \
  --load-extension=$(pwd)/dist \           # Load ENX extension from dist/
  --disable-extensions-except=$(pwd)/dist \ # Disable other extensions
  --user-data-dir=/tmp/chrome-dev-enx \    # Separate Chrome profile
  "https://www.infoq.com/"                  # Open this URL
```

**Key flags**:
- `--load-extension`: Pre-load extension from directory
- `--disable-extensions-except`: Only enable ENX extension (faster startup)
- `--user-data-dir`: Separate Chrome profile (won't interfere with your personal Chrome)

### Why Auto-Reload Works

1. **`task watch`**: Vite rebuilds to `dist/` when source files change
2. **Chrome watches `dist/`**: The Chrome instance monitors the extension directory
3. **Auto-reload**: Chrome detects changes and automatically reloads the extension
4. **No manual action**: No need to click reload in `chrome://extensions/`!

This is the **same mechanism** used by Playwright in E2E tests (see `playwright.config.ts`).

## Development Workflow

### Complete Setup

```bash
# 1. Build extension first (one time)
cd enx-chrome
pnpm build

# 2. Start backend API (terminal 1)
cd ../enx-api
task run

# 3. Start watch mode (terminal 2)
cd ../enx-chrome
task watch

# 4. Launch Chrome with extension (terminal 3)
cd ../enx-chrome
task dev-chrome URL=https://www.infoq.com/
```

### Development Loop

1. **Edit code** in your editor
2. **Watch auto-rebuilds** (see output in terminal 2)
3. **Extension auto-reloads** in Chrome (no manual action!)
4. **Test changes** on the web page
5. **Repeat** - edit, watch rebuild, test

### Multiple URLs

Want to test on different sites? Open multiple Chrome instances:

```bash
# Terminal 3 - InfoQ
task dev-chrome URL=https://www.infoq.com/

# Terminal 4 - BBC News
task dev-chrome URL=https://www.bbc.com/news

# Terminal 5 - Wikipedia
task dev-chrome URL=https://en.wikipedia.org/wiki/TypeScript
```

Each Chrome instance auto-reloads independently!

## Comparison with Other Methods

| Method                               | Auto-Rebuild | Auto-Reload   | Manual Steps                        | Use Case              |
| ------------------------------------ | ------------ | ------------- | ----------------------------------- | --------------------- |
| `task watch` only                    | ✅ Yes        | ❌ No          | Click reload in chrome://extensions | Simple development    |
| `task dev` (Vite HMR)                | ✅ Yes        | ❌ No (broken) | None (but has issues)               | ⚠️ Not recommended     |
| **`task watch` + `task dev-chrome`** | ✅ Yes        | ✅ Yes         | None!                               | **✨ Best experience** |
| E2E tests                            | ✅ Yes        | ✅ Yes         | None                                | Automated testing     |

## User Data Directory

The Chrome instance uses `/tmp/chrome-dev-enx` as its user data directory:

**Benefits**:
- Separate from your personal Chrome profile
- Won't interfere with your existing Chrome sessions
- Can be safely deleted anytime
- Fresh start each time (no stale cache issues)

**Cleanup** (optional):
```bash
rm -rf /tmp/chrome-dev-enx
```

## Troubleshooting

### "google-chrome command not found"

**macOS**:
```bash
# Update Taskfile.yml to use:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
```

**Windows**:
```bash
# Update Taskfile.yml to use:
"C:\Program Files\Google\Chrome\Application\chrome.exe"
```

**Linux** (alternative names):
```bash
chromium-browser  # Debian/Ubuntu
chromium          # Arch/Fedora
google-chrome-stable
```

### Extension not loading

1. **Build first**: Run `pnpm build` before `task dev-chrome`
2. **Check dist/**: Verify `dist/manifest.json` exists
3. **Rebuild**: Run `task build` to rebuild extension

### Extension not auto-reloading

1. **Verify watch mode running**: Check terminal 2 for rebuild messages
2. **Check dist/ changes**: Run `ls -la dist/` to see timestamp changes
3. **Restart Chrome**: Kill Chrome and run `task dev-chrome` again

### Chrome already running error

If you get "user data directory already in use":

```bash
# Kill existing Chrome dev instance
pkill -f "chrome-dev-enx"

# Or use a different user data directory
# Edit Taskfile.yml and change /tmp/chrome-dev-enx to /tmp/chrome-dev-enx-2
```

## Integration with E2E Tests

This approach uses the **same technique** as E2E tests:

**E2E Tests** (`playwright.config.ts`):
```typescript
use: {
  ...devices['Desktop Chrome'],
  headless: false,
}
```

**Dev Chrome** (`task dev-chrome`):
```bash
google-chrome --load-extension=$(pwd)/dist ...
```

Both launch Chrome with the extension pre-loaded, enabling auto-reload!

## Benefits

✅ **Zero manual reloads** - Extension reloads automatically on code changes
✅ **Fast iteration** - Edit code and see changes immediately
✅ **Multiple instances** - Test on different URLs simultaneously
✅ **Isolated environment** - Separate Chrome profile won't affect personal browsing
✅ **Same as E2E** - Uses proven technique from Playwright tests
✅ **No security issues** - Works around Chrome's extension security policies

## Next Steps

- Try editing `src/content/content.ts` and see the changes auto-reload!
- Test on different websites with custom URLs
- Compare with manual reload workflow to see time savings
- Use this for daily development instead of `task watch` alone

---

**Pro Tip**: Keep `task dev-chrome` running in a dedicated terminal and reuse the Chrome window. You'll never need to manually reload the extension again! 🚀
