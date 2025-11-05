# Enx Chrome Extension

A modern Chrome extension built with React, TypeScript, and Jotai for state management.

## Tech Stack

- **React** - UI framework
- **TypeScript** - Type safety
- **Jotai** - State management
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Jest + Testing Library** - Testing
- **ESLint + Prettier** - Code quality
- **Sentry** - Error monitoring
- **pnpm** - Fast, disk space efficient package manager

## Getting Started

Install dependencies:

```bash
pnpm install
```

Set up environment variables:

```bash
cp .env.example .env
# Edit .env and add your Sentry DSN
```

Start development:

```bash
pnpm run dev
```

Build for production:

```bash
pnpm run build
```

## Scripts

- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production
- `pnpm run preview` - Preview production build
- `pnpm run test` - Run tests
- `pnpm run test:watch` - Run tests in watch mode
- `pnpm run lint` - Lint code
- `pnpm run lint:fix` - Fix linting issues
- `pnpm run format` - Format code
- `pnpm run format:check` - Check code formatting

## Extension Structure

- `src/popup/` - Popup UI components
- `src/options/` - Options page components
- `src/background/` - Background script
- `src/content/` - Content script
- `src/components/` - Shared React components
- `src/store/` - Jotai atoms for state management
- `src/lib/` - Utility functions and configurations

## Loading the Extension

1. Build the extension: `pnpm run build`
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist` folder

## Testing

Run tests with:

```bash
pnpm run test
```

The test setup includes:

- Jest configuration for TypeScript
- Testing Library for React components
- Mock Chrome APIs for extension testing
- Coverage reporting

## Development Notes

- The extension uses Manifest V3
- Vite is configured to build separate entry points for popup, options, background, and content scripts
- Sentry integration for error monitoring (configure DSN in `.env`)
- Tailwind CSS for styling with a modern design system
- Jotai for lightweight state management across components

## Contributing

1. Follow the existing code style
2. Add tests for new features
3. Run linting and formatting before committing
4. Update documentation as needed
