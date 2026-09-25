export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.polyfills.js'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: {
    '\\.css$': '<rootDir>/src/test/styleMock.js',
    // Vite-only import.meta.env reader -> process.env stub (see buildEnv.ts)
    '^(\\.|@/config)/buildEnv$': '<rootDir>/src/test/buildEnvStub.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(ts|tsx)',
    '<rootDir>/src/**/*.(test|spec).(ts|tsx)',
  ],
  collectCoverageFrom: [
    'src/**/*.(ts|tsx)',
    '!src/**/*.d.ts',
    '!src/test/**/*',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
    // jotai 3 ships ESM only; compile it to CommonJS like our own sources.
    '^.+/node_modules/.+/jotai/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, esModuleInterop: true } },
    ],
  },
  // node_modules is untransformed by default; jotai is the exception. The
  // lookahead covers both pnpm's .pnpm/jotai@x store dir and the jotai/ dir.
  transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/jotai@|jotai/)'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  globals: {
    'import.meta': {
      env: {
        DEV: false,
        PROD: false,
        MODE: 'test',
      },
    },
  },
}
