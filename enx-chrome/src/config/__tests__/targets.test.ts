import {
  DEV_CLERK_PUBLISHABLE_KEY,
  resolveBuildTarget,
  stampedEnv,
} from '../targets'

// What vite.config.ts stamps into a build: the Vite mode (or VITE_ENV) picks a
// target, then per-URL VITE_* overrides apply on top.
describe('resolveBuildTarget', () => {
  it.each([
    ['development', 'development', 'http://localhost:8091'],
    ['homelab', 'homelab', 'https://enx-api.wiloon.lab'],
    ['production', 'production', 'https://api.catglish.com'],
    ['test', 'test', 'http://localhost:8090'],
  ])('builds the %s mode against the %s target', (mode, name, apiBaseUrl) => {
    const target = resolveBuildTarget(mode, {})
    expect(target.name).toBe(name)
    expect(target.apiBaseUrl).toBe(apiBaseUrl)
  })

  it('lets VITE_ENV win over the Vite mode', () => {
    expect(resolveBuildTarget('development', { VITE_ENV: 'prod' }).name).toBe(
      'production'
    )
  })

  it('falls back to the homelab target for an unknown mode', () => {
    expect(resolveBuildTarget('nonsense', {}).name).toBe('homelab')
  })

  it('applies the per-URL overrides', () => {
    const target = resolveBuildTarget('production', {
      VITE_API_BASE_URL: 'http://192.168.50.71:8090',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_x',
      VITE_ENX_UI_ORIGINS: 'https://a.example, https://b.example',
    })
    expect(target.name).toBe('production')
    expect(target.apiBaseUrl).toBe('http://192.168.50.71:8090')
    expect(target.frontendBaseUrl).toBe('https://catglish.com')
    expect(target.clerkPublishableKey).toBe('pk_live_x')
    expect(target.uiOrigins).toEqual(['https://a.example', 'https://b.example'])
  })

  // The RSSX Reader is a LAN host: only the homelab and dev builds adapt to it.
  it.each([
    ['development', ['https://rssx-lab.wiloon.com']],
    ['homelab', ['https://rssx-lab.wiloon.com']],
    ['production', []],
    ['test', []],
  ])('declares the RSSX origins of the %s target', (mode, rssxOrigins) => {
    expect(resolveBuildTarget(mode, {}).rssxOrigins).toEqual(rssxOrigins)
  })

  // Generic injection only: every declared target leaves it empty, so only an
  // override (the E2E fixture) adds a content-script site.
  it.each(['development', 'homelab', 'production', 'test'])(
    'declares no generic content-script origins in the %s target',
    mode => {
      expect(resolveBuildTarget(mode, {}).contentScriptOrigins).toEqual([])
    }
  )

  it('replaces only the generic content-script origins with VITE_CONTENT_SCRIPT_ORIGINS', () => {
    const target = resolveBuildTarget('development', {
      VITE_CONTENT_SCRIPT_ORIGINS:
        ' http://localhost:8765 ,, https://c.example',
    })
    expect(target.contentScriptOrigins).toEqual([
      'http://localhost:8765',
      'https://c.example',
    ])
    expect(target.uiOrigins).toEqual(['http://localhost:3000'])
    expect(target.rssxOrigins).toEqual(['https://rssx-lab.wiloon.com'])
  })

  it('keeps the target content-script origins when the override is empty', () => {
    expect(
      resolveBuildTarget('development', { VITE_CONTENT_SCRIPT_ORIGINS: '' })
        .contentScriptOrigins
    ).toEqual([])
  })
})

describe('stampedEnv', () => {
  it('stamps the selected target RSSX origins', () => {
    expect(
      stampedEnv(resolveBuildTarget('homelab', {})).VITE_RSSX_ORIGINS
    ).toBe('https://rssx-lab.wiloon.com')
    expect(
      stampedEnv(resolveBuildTarget('production', {})).VITE_RSSX_ORIGINS
    ).toBe('')
  })

  it('stamps only the selected target, never another target value', () => {
    const stamped = JSON.stringify(
      stampedEnv(
        resolveBuildTarget('production', {
          VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_x',
        })
      )
    )
    for (const foreign of [
      'localhost',
      'wiloon.lab',
      'rssx-lab.wiloon.com',
      DEV_CLERK_PUBLISHABLE_KEY,
    ]) {
      expect(stamped).not.toContain(foreign)
    }
  })
})
