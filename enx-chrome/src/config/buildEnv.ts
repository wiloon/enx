// The only module that reads Vite's build-time `import.meta.env` (see envPrefix
// / define in vite.config.ts). ts-jest compiles to CommonJS and cannot parse
// `import.meta`, so jest.config.js maps this file to src/test/buildEnvStub.ts,
// which reads process.env instead. That keeps env.ts itself -- including the
// production-only API URL guard -- loadable and testable under Jest.
export type BuildEnvKey =
  | 'VITE_ENV'
  | 'VITE_API_BASE_URL'
  | 'VITE_FRONTEND_BASE_URL'
  | 'VITE_CLERK_PUBLISHABLE_KEY'
  | 'VITE_CLERK_SYNC_HOST'
  | 'VITE_ENX_UI_ORIGINS'
  | 'VITE_RSSX_ORIGINS'
  | 'VITE_SENTRY_DSN'
  | 'VITE_HAN_CHAR_LIMIT'
  | 'VITE_BUILD_COMMIT'
  | 'VITE_BUILD_TIME'

export const readBuildEnv = (key: BuildEnvKey): string | undefined => {
  switch (key) {
    case 'VITE_ENV':
      return import.meta.env.VITE_ENV
    case 'VITE_API_BASE_URL':
      return import.meta.env.VITE_API_BASE_URL
    case 'VITE_FRONTEND_BASE_URL':
      return import.meta.env.VITE_FRONTEND_BASE_URL
    case 'VITE_CLERK_PUBLISHABLE_KEY':
      return import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
    case 'VITE_CLERK_SYNC_HOST':
      return import.meta.env.VITE_CLERK_SYNC_HOST
    case 'VITE_ENX_UI_ORIGINS':
      return import.meta.env.VITE_ENX_UI_ORIGINS
    case 'VITE_RSSX_ORIGINS':
      return import.meta.env.VITE_RSSX_ORIGINS
    case 'VITE_SENTRY_DSN':
      return import.meta.env.VITE_SENTRY_DSN
    case 'VITE_HAN_CHAR_LIMIT':
      return import.meta.env.VITE_HAN_CHAR_LIMIT
    case 'VITE_BUILD_COMMIT':
      return import.meta.env.VITE_BUILD_COMMIT
    case 'VITE_BUILD_TIME':
      return import.meta.env.VITE_BUILD_TIME
  }
}
