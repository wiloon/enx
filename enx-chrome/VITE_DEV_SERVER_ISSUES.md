# Vite Dev Server Issues with Chrome Extensions

## Problem

When using `task dev` (Vite dev server), the Chrome extension popup shows:
- ❌ "cannot connect to vite server" error message
- ❌ Popup keeps flashing/reloading
- ❌ Extension functionality doesn't work

## Root Cause

`@crxjs/vite-plugin` in development mode tries to connect to Vite dev server at `http://localhost:5173` for Hot Module Replacement (HMR). However:

1. Chrome extension security policies may block connections to localhost
2. Service worker and popup context have different security constraints
3. The popup repeatedly tries to reconnect, causing the flashing behavior

## Solution

**Use watch mode instead of dev server for local Chrome extension development:**

```bash
# ❌ DON'T USE (causes issues)
task dev

# ✅ USE THIS INSTEAD
task watch
```

### Watch Mode Workflow

1. **Start watch mode:**
   ```bash
   task watch
   ```

2. **Make code changes** - watch mode auto-rebuilds to `dist/`

3. **Manually reload extension:**
   - Open `chrome://extensions/`
   - Click the reload button for ENX extension
   - Or use keyboard shortcut (Chrome usually shows this)

4. **Test changes** - extension now uses updated code

### Why Watch Mode Works

- ✅ Builds to `dist/` directory (standard Chrome extension format)
- ✅ No localhost server connection required
- ✅ No HMR websocket connections
- ✅ Works reliably with Chrome extension security model
- ✅ Same output as `task build` (production-ready)

### When to Use Each Command

| Command          | Use Case              | Notes                                        |
| ---------------- | --------------------- | -------------------------------------------- |
| `task watch`     | **Local development** | ✅ Recommended - auto-rebuild + manual reload |
| `task build`     | One-time build        | Same as watch but no auto-rebuild            |
| `task build-dev` | Alias for build       | Uses local API (`localhost:8090`)            |
| `task dev`       | ⚠️  Not recommended    | May cause "cannot connect" errors            |

## Technical Details

### Vite Dev Server Behavior

When running `task dev`:

1. Vite starts dev server on `http://localhost:5173`
2. Generated `dist/service-worker-loader.js` contains:
   ```javascript
   import 'http://localhost:5173/@vite/env';
   import 'http://localhost:5173/@crx/client-worker';
   import 'http://localhost:5173/src/background/background.ts';
   ```
3. Extension tries to load these modules from localhost
4. **Connection fails** due to security policies → error message
5. Popup tries to reconnect → **flashing behavior**

### Watch Mode Behavior

When running `task watch`:

1. Vite runs `vite build --watch`
2. Generates complete bundled files in `dist/`
3. No localhost server required
4. Extension loads from `dist/` directly
5. **Works reliably** ✅

## Verification

After switching to watch mode, verify:

1. ✅ No "cannot connect to vite server" errors
2. ✅ Popup opens normally without flashing
3. ✅ Login works
4. ✅ Word highlighting works
5. ✅ Translation popup works

## References

- [Vite Build Options](https://vitejs.dev/guide/build.html#watch-mode)
- [@crxjs/vite-plugin Documentation](https://crxjs.dev/vite-plugin)
- Chrome Extension [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)

---

**Last Updated**: 2025-11-09
**Issue**: Vite dev server incompatibility with Chrome extensions
**Solution**: Use `task watch` for local development
