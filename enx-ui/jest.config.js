const nextJest = require('next/jest')

// A zone that is never UTC, so tests of browser-local dates catch UTC
// formatting and UTC-day grouping, locally and in CI alike (ADR-063).
process.env.TZ = 'America/Los_Angeles'

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  setupFiles: ['<rootDir>/jest.polyfills.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jsdom',
  // Not '<rootDir>/e2e/': the pattern is a regex and <rootDir> goes in
  // unescaped, so a checkout path with '+' (a Claude Code worktree for a
  // `fix/…` branch) stops matching and jest runs the Playwright specs.
  testPathIgnorePatterns: ['/e2e/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

// next-intl and use-intl ship ES modules only, so they are compiled like our
// own code. next/jest builds transformIgnorePatterns that skip node_modules
// except a short allow-list starting with geist (its transpiled packages);
// these packages join that list in every pattern, pnpm layout included
// (pnpm names a scoped package's directory @scope+name@version).
const ESM_PACKAGES = [
  'next-intl',
  'use-intl',
  'icu-minify',
  'intl-messageformat',
  '@formatjs[/+][^/@]+',
]

module.exports = async () => {
  const config = await createJestConfig(customJestConfig)()
  config.transformIgnorePatterns = config.transformIgnorePatterns.map((p) =>
    p.replaceAll('(geist|', `(geist|${ESM_PACKAGES.join('|')}|`)
  )
  return config
}
