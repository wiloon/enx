jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    cognitoDomain: 'https://enx-auth.auth.us-east-1.amazoncognito.com',
    cognitoClientId: '645kitlgap7l1q4ebrfkmi9ltv',
    environment: 'test',
  },
}))

import {
  buildAuthorizeUrl,
  buildLogoutUrl,
  buildRefreshTokenBody,
  buildTokenExchangeBody,
  createPkcePair,
  exchangeCodeForTokens,
  getChromeRedirectUri,
  getCognitoConfigForExtension,
  signInWithCognito,
  signOutWithCognito,
} from '../cognito'

const TEST_EXTENSION_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'
const TEST_CONFIG = {
  domain: 'https://auth.example.com',
  clientId: 'test-client-id',
  redirectUri: getChromeRedirectUri(TEST_EXTENSION_ID),
}

function useNodeWebCrypto() {
  const { webcrypto } = require('crypto')
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
}

function mockChromeIdentity(redirectUrl: string | undefined) {
  ;(chrome.identity.launchWebAuthFlow as jest.Mock).mockImplementation(
    (_options, callback) => {
      callback(redirectUrl)
    }
  )
}

describe('cognito helpers', () => {
  beforeAll(() => {
    useNodeWebCrypto()
  })

  beforeEach(() => {
    jest.resetAllMocks()
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})
    ;(chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.storage.session.remove as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('getChromeRedirectUri uses chromiumapp.org callback', () => {
    expect(getChromeRedirectUri(TEST_EXTENSION_ID)).toBe(
      `https://${TEST_EXTENSION_ID}.chromiumapp.org/callback`
    )
  })

  it('getCognitoConfigForExtension reads config fallback', () => {
    const cfg = getCognitoConfigForExtension(TEST_EXTENSION_ID)
    expect(cfg.domain).toContain('amazoncognito.com')
    expect(cfg.clientId).toBeTruthy()
    expect(cfg.redirectUri).toBe(getChromeRedirectUri(TEST_EXTENSION_ID))
  })

  it('buildAuthorizeUrl includes PKCE params', () => {
    const url = new URL(buildAuthorizeUrl(TEST_CONFIG, 'challenge-value'))
    expect(url.pathname).toBe('/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value')
    expect(url.searchParams.get('redirect_uri')).toBe(TEST_CONFIG.redirectUri)
  })

  it('buildLogoutUrl uses Cognito /logout and exact logout_uri', () => {
    const url = new URL(buildLogoutUrl(TEST_CONFIG, TEST_CONFIG.redirectUri))
    expect(url.pathname).toBe('/logout')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('logout_uri')).toBe(TEST_CONFIG.redirectUri)
  })

  it('buildTokenExchangeBody includes PKCE verifier', () => {
    const body = buildTokenExchangeBody(TEST_CONFIG, 'auth-code', 'verifier')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('code_verifier')).toBe('verifier')
  })

  it('buildRefreshTokenBody includes refresh token', () => {
    const body = buildRefreshTokenBody(TEST_CONFIG, 'refresh-token')
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('refresh-token')
  })

  it('createPkcePair returns verifier and challenge', async () => {
    const { verifier, challenge } = await createPkcePair()
    expect(verifier).toHaveLength(64)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('exchangeCodeForTokens posts to token endpoint', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access', refresh_token: 'refresh' }),
    })

    const tokens = await exchangeCodeForTokens(
      TEST_CONFIG,
      'auth-code',
      'verifier'
    )

    expect(tokens.access_token).toBe('access')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://auth.example.com/oauth2/token',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('signInWithCognito completes OAuth code flow', async () => {
    const callback = `${TEST_CONFIG.redirectUri}?code=auth-code`
    mockChromeIdentity(callback)
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
      'enx-oauth-verifier': 'stored-verifier',
    })
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access', refresh_token: 'refresh' }),
    })

    const tokens = await signInWithCognito()

    expect(tokens.access_token).toBe('access')
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalled()
    expect(chrome.storage.session.set).toHaveBeenCalled()
    expect(chrome.storage.session.remove).toHaveBeenCalledWith('enx-oauth-verifier')
  })

  it('signInWithCognito fails when OAuth flow is cancelled', async () => {
    mockChromeIdentity(undefined)
    await expect(signInWithCognito()).rejects.toThrow('Sign-in cancelled')
  })

  it('signInWithCognito surfaces Cognito error_description', async () => {
    mockChromeIdentity(
      `${TEST_CONFIG.redirectUri}?error=access_denied&error_description=User%20denied`
    )
    await expect(signInWithCognito()).rejects.toThrow('User denied')
  })

  it('signOutWithCognito launches Cognito logout URL', async () => {
    mockChromeIdentity(TEST_CONFIG.redirectUri)
    await signOutWithCognito()
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining('/logout?'),
        interactive: true,
      }),
      expect.any(Function)
    )
  })

  it('signOutWithCognito ignores cancelled logout window', async () => {
    mockChromeIdentity(undefined)
    await expect(signOutWithCognito()).resolves.toBeUndefined()
  })
})
