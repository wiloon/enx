import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
import prettierRecommended from 'eslint-plugin-prettier/recommended'

const eslintConfig = [
  // Flat config does not read .eslintignore, so build output and run
  // artifacts have to be ignored here (mirrors .gitignore).
  {
    ignores: [
      '.next/',
      'node_modules/',
      'out/',
      'build/',
      'coverage/',
      '.vercel/',
      'next-env.d.ts',
      // Playwright run artifacts, regenerated on every run
      'test-results/',
      'playwright-report/',
      'blob-report/',
      'playwright/.cache/',
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  // Jest loads these two as CommonJS (package.json has no "type": "module"),
  // so require() is the correct form here.
  {
    files: ['jest.config.js', 'jest.polyfills.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Registers the `prettier` plugin, enables `prettier/prettier: error`, and
  // applies eslint-config-prettier so formatting rules from the Next/TS
  // presets do not conflict with Prettier. Must come last.
  prettierRecommended,
]

export default eslintConfig
