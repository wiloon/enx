const STORAGE_VERIFIER = 'enx-oauth-verifier'

export type CognitoConfig = {
  domain: string
  clientId: string
  redirectUri: string
}

export type CognitoTokens = {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  token_type?: string
}

function getConfig() {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID
  const redirectUri =
    process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback`
      : '')
  if (!domain || !clientId || !redirectUri) {
    throw new Error('Cognito env not configured (NEXT_PUBLIC_COGNITO_*)')
  }
  return { domain: domain.replace(/\/$/, ''), clientId, redirectUri }
}

export function buildAuthorizeUrl(
  config: CognitoConfig,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${config.domain}/oauth2/authorize?${params}`
}

function normalizeLogoutUri(uri: string): string {
  // Cognito sign-out URLs must match app client config exactly (usually with trailing slash).
  return uri.endsWith('/') ? uri : `${uri}/`
}

export function buildLogoutUrl(
  config: Pick<CognitoConfig, 'domain' | 'clientId'>,
  logoutUri: string
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: normalizeLogoutUri(logoutUri),
  })
  return `${config.domain}/logout?${params}`
}

export async function createPkcePair(): Promise<{
  verifier: string
  challenge: string
}> {
  const verifier = randomString(64)
  const challenge = await sha256Base64Url(verifier)
  return { verifier, challenge }
}

function randomString(length: number): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function beginCognitoSignIn(): Promise<void> {
  const config = getConfig()
  const { verifier, challenge } = await createPkcePair()
  sessionStorage.setItem(STORAGE_VERIFIER, verifier)
  window.location.href = buildAuthorizeUrl(config, challenge)
}

export async function exchangeCodeForTokens(
  code: string
): Promise<CognitoTokens> {
  const { domain, clientId, redirectUri } = getConfig()
  const verifier = sessionStorage.getItem(STORAGE_VERIFIER)
  if (!verifier) {
    throw new Error('Missing PKCE verifier')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })

  const res = await fetch(`${domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${text}`)
  }
  sessionStorage.removeItem(STORAGE_VERIFIER)
  return res.json()
}

export function cognitoLogout(redirectUri?: string): void {
  const config = getConfig()
  const logoutUri = normalizeLogoutUri(
    redirectUri ||
      process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI ||
      (typeof window !== 'undefined' ? window.location.origin : '')
  )
  window.location.href = buildLogoutUrl(config, logoutUri)
}
