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

module.exports = createJestConfig(customJestConfig)
