import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.webextensions,
        chrome: 'readonly',
        __APP_VERSION__: 'readonly',
        React: 'readonly',
        // `process` never exists at runtime in an extension page/worker, but
        // Vite statically replaces `process.env.NODE_ENV` with a string literal
        // at build time (see its default `define`), so build-time reads of it
        // are legal here. Anything else on `process` would throw -- tsc, not
        // this entry, is what catches that.
        process: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react: react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'react/react-in-jsx-scope': 'off',
      // `_foo` is the codebase's marker for "kept for the signature, not used"
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  // Test files configuration
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/test/**/*.{ts,tsx}',
      '**/__tests__/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.browser,
        // Jest runs on Node: setup/mocks legitimately touch `global`, `__dirname`
        ...globals.node,
      },
    },
  },
  // Node.js configuration files and scripts. The globs must be `**/`-prefixed:
  // in flat config a bare `*.js` only matches the project root, which left
  // nested CommonJS helpers such as src/test/styleMock.js without node globals.
  // Extension/browser source is TypeScript, so this never captures it.
  {
    files: ['**/*.{js,cjs,mjs}', 'vite.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // Console snippets meant to be pasted into the extension's devtools
  {
    files: ['scripts/clear-api-config.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        chrome: 'readonly',
      },
    },
  },
  // Playwright E2E specs / config run under Node with browser-context evaluate()
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts', 'playwright.*.config.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        chrome: 'readonly',
      },
    },
    rules: {
      // Playwright fixtures receive a `use` callback; the React Hooks plugin
      // reads every `use(...)` call as React's `use` hook and flags it.
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  // Not source: build output, dependencies and local run artifacts. Flat config
  // does not read .gitignore, so every directory ignored there has to be
  // repeated here -- `.chrome-dev-profile/` in particular is a Chrome user-data
  // directory holding Chrome's own bundled, minified JavaScript.
  {
    ignores: [
      'dist/**',
      'dist-*/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      '.nyc_output/**',
      '.chrome-dev-profile/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**',
    ],
  },
]
