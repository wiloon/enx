import { readBuildEnv, type BuildEnvKey } from '../../src/config/buildEnv'

const selected: BuildEnvKey = 'VITE_ENV'
readBuildEnv(selected)
// @ts-expect-error Unknown variables are outside the build env allowlist.
readBuildEnv('VITE_LEAKPROBE')
