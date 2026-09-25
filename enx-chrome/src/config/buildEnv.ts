// The only module that reads Vite's build-time `import.meta.env` (see envPrefix
// / define in vite.config.ts). ts-jest compiles to CommonJS and cannot parse
// `import.meta`, so jest.config.js maps this file to src/test/buildEnvStub.ts,
// which reads process.env instead. That keeps env.ts itself -- including the
// production-only API URL guard -- loadable and testable under Jest.
export const readBuildEnv = (key: string): string | undefined =>
  import.meta.env?.[key] as string | undefined
