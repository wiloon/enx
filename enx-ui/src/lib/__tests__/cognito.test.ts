const COGNITO_ENV = {
  NEXT_PUBLIC_COGNITO_DOMAIN: 'https://auth.example.com',
  NEXT_PUBLIC_COGNITO_CLIENT_ID: 'test-client-id',
  NEXT_PUBLIC_COGNITO_REDIRECT_URI: 'http://localhost:3000/auth/callback',
}

const TEST_CONFIG = {
  domain: 'https://auth.example.com',
  clientId: 'test-client-id',
  redirectUri: 'http://localhost:3000/auth/callback',
}

function setCognitoEnv() {
  process.env.NEXT_PUBLIC_COGNITO_DOMAIN = COGNITO_ENV.NEXT_PUBLIC_COGNITO_DOMAIN
  process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID = COGNITO_ENV.NEXT_PUBLIC_COGNITO_CLIENT_ID
  process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI =
    COGNITO_ENV.NEXT_PUBLIC_COGNITO_REDIRECT_URI
}

function useNodeWebCrypto() {
  const { webcrypto } = require('crypto')
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  })
}

describe('cognito helpers', () => {
  beforeAll(() => {
    useNodeWebCrypto()
  })

  beforeEach(() => {
    setCognitoEnv()
    sessionStorage.clear()
    jest.resetAllMocks()
  })

  it('buildAuthorizeUrl includes PKCE authorize params', async () => {
    const { buildAuthorizeUrl } = await import('../cognito')
    const url = new URL(buildAuthorizeUrl(TEST_CONFIG, 'test-challenge'))

    expect(url.origin).toBe('https://auth.example.com')
    expect(url.pathname).toBe('/oauth2/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/callback'
    )
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe('test-challenge')
  })

  it('buildLogoutUrl includes logout params', async () => {
    const { buildLogoutUrl } = await import('../cognito')
    const url = new URL(
      buildLogoutUrl(TEST_CONFIG, 'http://localhost:3000/')
    )

    expect(url.pathname).toBe('/logout')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('logout_uri')).toBe('http://localhost:3000/')
  })

  it('buildLogoutUrl normalizes logout_uri trailing slash', async () => {
    const { buildLogoutUrl } = await import('../cognito')
    const url = new URL(buildLogoutUrl(TEST_CONFIG, 'http://localhost:3000'))

    expect(url.searchParams.get('logout_uri')).toBe('http://localhost:3000/')
  })

  it('createPkcePair returns verifier and S256 challenge', async () => {
    const { createPkcePair } = await import('../cognito')
    const { verifier, challenge } = await createPkcePair()

    expect(verifier).toHaveLength(64)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).not.toContain('=')
  })

  it('beginCognitoSignIn stores verifier for PKCE', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { beginCognitoSignIn } = await import('../cognito')

    await beginCognitoSignIn()

    expect(sessionStorage.getItem('enx-oauth-verifier')).toHaveLength(64)
    errorSpy.mockRestore()
  })

  it('exchangeCodeForTokens posts PKCE verifier to token endpoint', async () => {
    sessionStorage.setItem('enx-oauth-verifier', 'test-verifier')
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access',
        refresh_token: 'refresh',
      }),
    })

    const { exchangeCodeForTokens } = await import('../cognito')
    const tokens = await exchangeCodeForTokens('auth-code')

    expect(tokens.access_token).toBe('access')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://auth.example.com/oauth2/token',
      expect.objectContaining({ method: 'POST' })
    )

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]
    const body = (init as RequestInit).body as URLSearchParams
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('code_verifier')).toBe('test-verifier')
    expect(body.get('client_id')).toBe('test-client-id')
    expect(sessionStorage.getItem('enx-oauth-verifier')).toBeNull()
  })

  it('exchangeCodeForTokens fails when PKCE verifier is missing', async () => {
    const { exchangeCodeForTokens } = await import('../cognito')
    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'Missing PKCE verifier'
    )
  })

  it('exchangeCodeForTokens keeps verifier when token exchange fails', async () => {
    sessionStorage.setItem('enx-oauth-verifier', 'test-verifier')
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    })

    const { exchangeCodeForTokens } = await import('../cognito')
    await expect(exchangeCodeForTokens('auth-code')).rejects.toThrow(
      'Token exchange failed: 400 invalid_grant'
    )
    expect(sessionStorage.getItem('enx-oauth-verifier')).toBe('test-verifier')
  })

  it('throws when Cognito env is not configured', async () => {
    delete process.env.NEXT_PUBLIC_COGNITO_DOMAIN
    delete process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
    delete process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI

    jest.resetModules()
    const { beginCognitoSignIn } = await import('../cognito')
    await expect(beginCognitoSignIn()).rejects.toThrow(
      'Cognito env not configured'
    )
  })
})
