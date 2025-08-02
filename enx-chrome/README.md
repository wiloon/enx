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

## Getting Started

Install dependencies:

```bash
npm install
```

Set up environment variables:

```bash
cp .env.example .env
# Edit .env and add your Sentry DSN
```

Start development:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Lint code
- `npm run lint:fix` - Fix linting issues
- `npm run format` - Format code
- `npm run format:check` - Check code formatting

## Extension Structure

- `src/popup/` - Popup UI components
- `src/options/` - Options page components
- `src/background/` - Background script
- `src/content/` - Content script
- `src/components/` - Shared React components
- `src/store/` - Jotai atoms for state management
- `src/lib/` - Utility functions and configurations

## Loading the Extension

1. Build the extension: `npm run build`
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist` folder

## Testing

Run tests with:

```bash
npm run test
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
