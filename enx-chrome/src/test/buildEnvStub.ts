// Jest stand-in for src/config/buildEnv.ts (mapped in jest.config.js). A test
// picks a build by setting process.env (e.g. VITE_ENV=production) and then
// loading env.ts inside jest.isolateModules. MODE defaults to 'test', the way
// Vite always sets MODE for a real build.
export const readBuildEnv = (key: string): string | undefined =>
  process.env[key] ?? (key === 'MODE' ? 'test' : undefined)
