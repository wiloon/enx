import { resolveBuildTarget } from '../targets'

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
})
