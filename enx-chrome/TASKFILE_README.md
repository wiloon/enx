# Taskfile Usage Guide - Chrome Extension

This project uses [Task](https://taskfile.dev) as a task runner for development.

## Installation

Install Task on macOS:

```bash
brew install go-task/tap/go-task
```

## Quick Start

### First time setup

```bash
task setup
```

This will install dependencies and build the extension.

### Development workflow

```bash
# Start development server with hot reload
task dev

# Build extension
task build

# Rebuild and get reminder to reload in Chrome
task reload
```

## Common Tasks

### Development

```bash
# Install dependencies
task install

# Start dev server (hot reload)
task dev

# Build for production
task build

# Build in watch mode
task build-watch

# Preview production build
task preview
```

### Testing

```bash
# Run tests
task test

# Run tests in watch mode
task test-watch

# Run tests with coverage
task test-coverage
```

### Code Quality

```bash
# Lint code
task lint

# Fix linting issues
task lint-fix

# Format code
task format

# Check formatting
task format-check

# Run all checks
task check
```

### Packaging

```bash
# Create distributable zip for Chrome Web Store
task pack
```

This creates `enx-chrome-extension-v{version}.zip` ready to upload.

### Maintenance

```bash
# Clean build artifacts
task clean-dist

# Clean everything (including node_modules)
task clean

# Check for outdated dependencies
task deps-update

# Check for security vulnerabilities
task deps-audit

# Fix security vulnerabilities
task deps-audit-fix

# Show version
task version
```

### Chrome Extension Management

```bash
# Open Chrome extensions page
task open-chrome
```

Then manually click the reload button for the extension.

## Development Workflow

### First time setup

```bash
cd enx-chrome
task setup
```

### Load extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist` directory

### During development

**Hot Reload Enabled! 🔥**

This project uses `@crxjs/vite-plugin` for automatic extension reloading.

```bash
task dev
```

**What happens:**

1. ✅ Code changes are automatically detected
2. ✅ Extension is automatically rebuilt
3. ✅ **Chrome extension is automatically reloaded** (no manual refresh needed!)

**Note:** Some changes (like manifest.json modifications) may still require a manual reload.

**Manual reload (if needed):**

```bash
# In rare cases, manually reload:
task reload

# Or open extensions page:
task open-chrome
# Then click the reload button
```

## Environment Configuration

The extension uses different API endpoints based on the environment:

### Default Environments

- **Development** (`task dev`): `http://localhost:8090` - connects to local API server
- **Staging** (`VITE_ENV=staging`): `https://enx-dev.wiloon.com` - dev server
- **Production** (`task build`): `https://enx.wiloon.com` - production server

### Override Environment

Create a `.env` file to override the environment:

```bash
# Use local development server
VITE_ENV=development

# Or use staging server
VITE_ENV=staging

# Or use production server
VITE_ENV=production
```

### Runtime Configuration

Users can also override the API URL at runtime through Chrome storage:

```javascript
// In console of extension background page
chrome.storage.local.set({ apiBaseUrl: 'http://custom-server:8090' })

// Reset to default
chrome.storage.local.remove('apiBaseUrl')
```

### Before committing

```bash
task check
```

### Creating a release

```bash
# Update version in package.json first
task pack
```

This creates a zip file ready for Chrome Web Store.

## CI/CD

```bash
task ci
```

Runs the complete CI workflow: install → lint → test → build

## Tips

- Use `task dev` for active development with hot reload
- Use `task build` when you need a production build
- Use `task pack` to create distributable package
- Run `task check` before committing to ensure code quality
- Use `task reload` as a quick build + reminder workflow

## Troubleshooting

### Extension not updating

After `task build`, you need to:

1. Go to `chrome://extensions`
2. Click the reload button on the extension

Or use `task open-chrome` to quickly open the extensions page.

### Build errors

```bash
task clean
task install
task build
```

### Node modules issues

```bash
task clean
task setup
```

## Project Structure

```
enx-chrome/
├── src/           # Source code
├── icons/         # Extension icons
├── dist/          # Build output (load this in Chrome)
├── manifest.json  # Extension manifest
└── Taskfile.yml   # Task definitions
```

## Requirements

- Node.js 20+
- pnpm (Fast, disk space efficient package manager)
- Task runner
- Google Chrome

## Package Manager

This project uses **pnpm** instead of npm for faster installs and better disk space efficiency.

Install pnpm:

```bash
npm install -g pnpm
# or
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

## Available Scripts (via Task)

All pnpm scripts are wrapped in Task commands for consistency with the rest of the project.

| Task Command  | pnpm Script       | Description        |
| ------------- | ----------------- | ------------------ |
| `task dev`    | `pnpm run dev`    | Development server |
| `task build`  | `pnpm run build`  | Production build   |
| `task test`   | `pnpm test`       | Run tests          |
| `task lint`   | `pnpm run lint`   | Lint code          |
| `task format` | `pnpm run format` | Format code        |
