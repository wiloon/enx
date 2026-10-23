// env.ts computes its config at import time from the build env, so each test
// picks a build via process.env (read by src/test/buildEnvStub.ts, which stamps
// the target the way vite.config.ts does) and loads a fresh copy of the module.

type EnvModule = typeof import('../env')

const BUILD_ENV_KEYS = [
  'VITE_ENV',
  'MODE',
  'VITE_API_BASE_URL',
  'VITE_ENX_UI_ORIGINS',
  'VITE_HAN_CHAR_LIMIT',
  'VITE_BUILD_COMMIT',
  'VITE_BUILD_TIME',
] as const

const loadEnv = (
  buildEnv: Partial<Record<(typeof BUILD_ENV_KEYS)[number], string>>
) => {
  for (const key of BUILD_ENV_KEYS) delete process.env[key]
  Object.assign(process.env, buildEnv)
  let mod: EnvModule | undefined
  jest.isolateModules(() => {
    mod = jest.requireActual<EnvModule>('../env')
  })
  return mod!
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  for (const key of BUILD_ENV_KEYS) delete process.env[key]
  jest.restoreAllMocks()
})

describe('build stamp', () => {
  it('carries the commit and build time vite.config.ts stamped', () => {
    const { config } = loadEnv({
      VITE_BUILD_COMMIT: '1a2b3c4',
      VITE_BUILD_TIME: '2026-10-13T08:05:00.000Z',
    })
    expect(config.buildCommit).toBe('1a2b3c4')
    expect(config.builtAt).toBe('2026-10-13T08:05:00.000Z')
  })

  it('has neither in an unstamped build', () => {
    const { config } = loadEnv({})
    expect(config.buildCommit).toBeUndefined()
    expect(config.builtAt).toBeUndefined()
  })
})

describe('build target', () => {
  it('uses the test target when nothing selects a build', () => {
    expect(loadEnv({}).config.environment).toBe('test')
  })

  it('lets VITE_ENV win over the Vite mode', () => {
    const { config } = loadEnv({ MODE: 'development', VITE_ENV: 'prod' })
    expect(config.environment).toBe('production')
    expect(config.apiBaseUrl).toBe('https://api.catglish.com')
  })

  it('points the development build at the local enx-api (`port` in enx-api/config.toml)', () => {
    const { config } = loadEnv({ MODE: 'development' })
    expect(config.environment).toBe('development')
    expect(config.apiBaseUrl).toBe('http://localhost:8091')
  })

  it('carries the production target', () => {
    const { config } = loadEnv({ MODE: 'production' })
    expect(config).toMatchObject({
      environment: 'production',
      apiBaseUrl: 'https://api.catglish.com',
      frontendBaseUrl: 'https://catglish.com',
      clerkSyncHost: 'https://clerk.catglish.com',
      uiOrigins: ['https://catglish.com'],
    })
  })

  it.each([
    ['homelab', ['https://rssx-lab.wiloon.com']],
    ['development', ['https://rssx-lab.wiloon.com']],
    ['production', []],
  ])('carries the RSSX origins of the %s build only', (mode, rssxOrigins) => {
    expect(loadEnv({ MODE: mode }).config.rssxOrigins).toEqual(rssxOrigins)
  })

  it('falls back to the homelab target for an unknown mode', () => {
    expect(loadEnv({ MODE: 'nonsense' }).config.environment).toBe('homelab')
  })

  it('applies the build-time overrides', () => {
    const { config } = loadEnv({
      VITE_ENV: 'homelab',
      VITE_API_BASE_URL: 'http://192.168.50.71:8090',
      VITE_ENX_UI_ORIGINS: 'https://a.example,https://b.example',
    })
    expect(config.apiBaseUrl).toBe('http://192.168.50.71:8090')
    expect(config.uiOrigins).toEqual(['https://a.example', 'https://b.example'])
  })
})

describe('Chinese-article limit (VITE_HAN_CHAR_LIMIT)', () => {
  it('defaults to 20', () => {
    expect(loadEnv({}).config.hanCharLimit).toBe(20)
  })

  it('takes the build env value', () => {
    expect(loadEnv({ VITE_HAN_CHAR_LIMIT: '5' }).config.hanCharLimit).toBe(5)
  })
})
