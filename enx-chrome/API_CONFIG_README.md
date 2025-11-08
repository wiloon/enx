# API Configuration Guide

## Configuration Locations

The Chrome extension's API address can be configured in the following locations:

### 1. Environment Configuration File (Primary Configuration)

**File**: `src/config/env.ts`

Environment auto-detection configuration:

- **development**: `http://localhost:8090` (Local development)
- **staging**: `https://enx-dev.wiloon.com` (Staging environment)
- **production**: `https://enx.wiloon.com` (Production environment)

### 2. .env File (Force Specific Environment)

**File**: `.env`

```bash
# Force development environment (http://localhost:8090)
VITE_ENV=development
```

### 3. Chrome Storage (Runtime Override)

The extension can save a custom API URL in Chrome Storage at runtime, which has the highest priority.

## How to Use Local API

### Method 1: Using .env File (Recommended)

1. Ensure the project root directory has a `.env` file with the following content:

   ```bash
   VITE_ENV=development
   ```

2. Restart the development server:

   ```bash
   task dev
   ```

3. Reload the extension (on chrome://extensions page)

### Method 2: Using Extension Options Page

1. Open the extension's options page in Chrome:
   - Right-click the extension icon → Select "Options"
   - Or visit `chrome-extension://<extension-id>/options.html`

2. In the "API URL Configuration" section:
   - Click the "Local (Development)" preset button
   - Or manually enter `http://localhost:8090`
   - Click "Save" to save

3. Re-login to the extension

### Method 3: Programmatic Setup

Run in the console:

```javascript
chrome.storage.local.set({ apiBaseUrl: 'http://localhost:8090' })
```

## Verify Current API Address

### Check Console Logs

Open Chrome DevTools, switch to the extension's background page or Popup page, and check the logs:

```
[ENX Config] Environment: development, API: http://localhost:8090
```

### Check Options Page

Open the extension's options page, in the "Current Environment" section you can see:

- Mode: development
- Default API: <http://localhost:8090>
- Active API: <http://localhost:8090>

## Permission Configuration

Host permissions for local API have been added in `manifest.json`:

```json
"host_permissions": [
  "http://localhost:8090/*",
  "https://enx-dev.wiloon.com/*",
  "https://enx.wiloon.com/*"
]
```

## Frequently Asked Questions

### Q: Why does the extension still access the remote API after running task dev?

**Possible reasons**:

1. **Chrome Storage has a previously saved API address**
   - Solution: Click "Reset to Default" on the options page
   - Or clear Chrome Storage: `chrome.storage.local.clear()`

2. **Missing or incorrect .env file**
   - Solution: Ensure the `.env` file exists and contains `VITE_ENV=development`

3. **Extension not reloaded**
   - Solution: Click the "Reload" button for the extension on chrome://extensions page

### Q: How to switch to staging/production environment?

**Method 1**: Modify the `.env` file

```bash
# Staging environment
VITE_ENV=staging

# Production environment
VITE_ENV=production
```

**Method 2**: Select the corresponding preset URL on the options page

### Q: How to confirm requests are being sent to the local API?

1. Check requests in the Network tab of Chrome DevTools
2. Confirm the request URL is `http://localhost:8090/api/login`
3. Check the logs of the local API server

## Development Workflow

1. Start the local API server:

   ```bash
   cd enx-api
   task dev  # or task run
   ```

2. Ensure the `.env` file exists and is configured for development

3. Start the Chrome extension development server:

   ```bash
   cd enx-chrome
   task dev
   ```

4. Reload the extension in Chrome

5. Test login functionality and confirm requests are sent to `http://localhost:8090`

## Login Testing

```bash
# The extension will send a request like this
curl 'http://localhost:8090/api/login' \
  -H 'Content-Type: application/json' \
  --data-raw '{"username":"wiloon","password":"haCahpro"}'
```

Ensure the local API server is running on port 8090 and can respond to this request.
