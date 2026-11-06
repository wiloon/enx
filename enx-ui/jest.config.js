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
  testPathIgnorePatterns: ['<rootDir>/e2e/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

module.exports = createJestConfig(customJestConfig)
