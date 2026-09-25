// env.ts computes its config at import time from the build env, so each test
// picks a build via process.env (read by src/test/buildEnvStub.ts) and loads a
// fresh copy of the module.

type EnvModule = typeof import('../env')

const BUILD_ENV_KEYS = ['VITE_ENV', 'MODE', 'VITE_API_BASE_URL'] as const

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

// chrome.storage.local backed by a plain object
let store: Record<string, unknown> = {}

beforeEach(() => {
  store = {}
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  chrome.storage.local.get = jest.fn(async (keys: string[]) =>
    Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]))
  ) as unknown as typeof chrome.storage.local.get
  chrome.storage.local.set = jest.fn(async (items: Record<string, unknown>) => {
    Object.assign(store, items)
  }) as unknown as typeof chrome.storage.local.set
  chrome.storage.local.remove = jest.fn(async (key: string) => {
    delete store[key]
  }) as unknown as typeof chrome.storage.local.remove
})

afterEach(() => {
  for (const key of BUILD_ENV_KEYS) delete process.env[key]
  jest.restoreAllMocks()
})

describe('build target selection', () => {
  it('uses the test target when nothing selects a build', () => {
    expect(loadEnv({}).config.environment).toBe('test')
  })

  it('lets VITE_ENV win over the Vite mode', () => {
    const { config } = loadEnv({ MODE: 'development', VITE_ENV: 'prod' })
    expect(config.environment).toBe('production')
    expect(config.apiBaseUrl).toBe('https://api.catglish.com')
  })

  it('falls back to the homelab target for an unknown mode', () => {
    expect(loadEnv({ MODE: 'nonsense' }).config.environment).toBe('homelab')
  })

  it('applies a VITE_API_BASE_URL override', () => {
    const { config } = loadEnv({
      VITE_ENV: 'homelab',
      VITE_API_BASE_URL: 'http://192.168.50.71:8090',
    })
    expect(config.apiBaseUrl).toBe('http://192.168.50.71:8090')
  })
})

describe('API URL override in a non-production build', () => {
  it('returns the build URL until one is stored', async () => {
    const env = loadEnv({ VITE_ENV: 'homelab' })
    expect(env.apiBaseUrlOverrideAllowed).toBe(true)
    expect(await env.getApiBaseUrl()).toBe('https://enx-api.wiloon.lab')
  })

  it('stores, returns and resets a custom URL', async () => {
    const env = loadEnv({ VITE_ENV: 'homelab' })

    await env.setApiBaseUrl('http://localhost:8090')
    expect(await env.getApiBaseUrl()).toBe('http://localhost:8090')

    await env.resetApiBaseUrl()
    expect(await env.getApiBaseUrl()).toBe('https://enx-api.wiloon.lab')
  })

  it('falls back to the build URL when storage cannot be read', async () => {
    const env = loadEnv({ VITE_ENV: 'homelab' })
    chrome.storage.local.get = jest.fn(async () => {
      throw new Error('storage unavailable')
    }) as unknown as typeof chrome.storage.local.get

    expect(await env.getApiBaseUrl()).toBe('https://enx-api.wiloon.lab')
  })
})

// The background attaches the Clerk session JWT to every API request, so a
// production build must never send it to a URL other than its own API.
describe('API URL override in a production build', () => {
  it('is disabled', () => {
    expect(loadEnv({ VITE_ENV: 'production' }).apiBaseUrlOverrideAllowed).toBe(
      false
    )
  })

  it('refuses to store a foreign URL', async () => {
    const env = loadEnv({ VITE_ENV: 'production' })

    await expect(env.setApiBaseUrl('https://evil.example')).rejects.toThrow(
      'Custom API URLs are disabled in this build'
    )
    expect(store).toEqual({})
  })

  it('ignores a foreign URL already in storage', async () => {
    const env = loadEnv({ VITE_ENV: 'production' })
    store.apiBaseUrl = 'https://evil.example'

    expect(await env.getApiBaseUrl()).toBe('https://api.catglish.com')
  })

  it('still accepts its own API URL', async () => {
    const env = loadEnv({ VITE_ENV: 'production' })

    await env.setApiBaseUrl('https://api.catglish.com')
    expect(await env.getApiBaseUrl()).toBe('https://api.catglish.com')
  })
})
