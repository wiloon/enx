// Jest stand-in for src/config/buildEnv.ts (mapped in jest.config.js). A test
// picks a build by setting process.env (e.g. VITE_ENV=production) and then
// loading env.ts inside jest.isolateModules. Like vite.config.ts, the stub
// resolves the target and stamps it (stampedEnv); MODE defaults to 'test', the
// way Vite always sets MODE for a real build.
import type { BuildEnvKey } from '@/config/buildEnv'
import { resolveBuildTarget, stampedEnv } from '@/config/targets'

export const readBuildEnv = (key: BuildEnvKey): string | undefined => {
  const mode = process.env.MODE ?? 'test'
  return (
    stampedEnv(resolveBuildTarget(mode, process.env))[key] ?? process.env[key]
  )
}
