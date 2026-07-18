import { config } from '@/config/env'

const VERIFIER_KEY = 'enx-oauth-verifier'

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
}

export function getChromeRedirectUri(extensionId: string): string {
  return `https://${extensionId}.chromiumapp.org/callback`
}

export function getCognitoConfigForExtension(extensionId: string): CognitoConfig {
  const domain = config.cognitoDomain
  const clientId = config.cognitoClientId
  if (!domain || !clientId) {
    throw new Error(
      'Cognito not configured (VITE_COGNITO_DOMAIN / VITE_COGNITO_CLIENT_ID)'
    )
  }
  return {
    domain: domain.replace(/\/$/, ''),
    clientId,
    redirectUri: getChromeRedirectUri(extensionId),
  }
}

function getCognitoConfig(): CognitoConfig {
  return getCognitoConfigForExtension(chrome.runtime.id)
}

export function buildAuthorizeUrl(
  cognitoConfig: CognitoConfig,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cognitoConfig.clientId,
    redirect_uri: cognitoConfig.redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${cognitoConfig.domain}/oauth2/authorize?${params}`
}

/** logout_uri must exactly match Cognito App Client logout_urls (chrome: same as callback, no trailing slash). */
export function buildLogoutUrl(
  cognitoConfig: Pick<CognitoConfig, 'domain' | 'clientId'>,
  logoutUri: string
): string {
  const params = new URLSearchParams({
    client_id: cognitoConfig.clientId,
    logout_uri: logoutUri,
  })
  return `${cognitoConfig.domain}/logout?${params}`
}

export function buildRefreshTokenBody(
  cognitoConfig: Pick<CognitoConfig, 'clientId'>,
  refreshToken: string
): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cognitoConfig.clientId,
    refresh_token: refreshToken,
  })
}

export function buildTokenExchangeBody(
  cognitoConfig: CognitoConfig,
  code: string,
  codeVerifier: string
): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cognitoConfig.clientId,
    code,
    redirect_uri: cognitoConfig.redirectUri,
    code_verifier: codeVerifier,
  })
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

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError) {
        const cfg = getCognitoConfigForExtension(chrome.runtime.id)
        reject(
          new Error(
            `${chrome.runtime.lastError.message}. Extension ID ${chrome.runtime.id} must be registered in Cognito callback URLs (${cfg.redirectUri}).`
          )
        )
        return
      }
      if (!redirectUrl) {
        reject(new Error('Sign-in cancelled'))
        return
      }
      resolve(redirectUrl)
    })
  })
}

export async function signInWithCognito(): Promise<CognitoTokens> {
  const cognitoConfig = getCognitoConfig()
  const { verifier, challenge } = await createPkcePair()
  await chrome.storage.session.set({ [VERIFIER_KEY]: verifier })

  const authUrl = buildAuthorizeUrl(cognitoConfig, challenge)
  const redirectUrl = await launchWebAuthFlow(authUrl)

  const parsed = new URL(redirectUrl)
  const code = parsed.searchParams.get('code')
  const err =
    parsed.searchParams.get('error_description') ||
    parsed.searchParams.get('error')
  if (err) throw new Error(err)
  if (!code) throw new Error('Missing authorization code')

  const stored = await chrome.storage.session.get(VERIFIER_KEY)
  const codeVerifier = stored[VERIFIER_KEY] as string
  await chrome.storage.session.remove(VERIFIER_KEY)
  if (!codeVerifier) throw new Error('Missing PKCE verifier')

  return exchangeCodeForTokens(cognitoConfig, code, codeVerifier)
}

/**
 * Clear Cognito Hosted UI session via /logout.
 * Uses the same chromiumapp callback URL registered as logout_urls in OpenTofu.
 */
export async function signOutWithCognito(): Promise<void> {
  const cognitoConfig = getCognitoConfig()
  const logoutUrl = buildLogoutUrl(cognitoConfig, cognitoConfig.redirectUri)
  try {
    await launchWebAuthFlow(logoutUrl)
  } catch (error) {
    // Local tokens are cleared by the caller first; Hosted UI clear is best-effort.
    if (error instanceof Error && error.message === 'Sign-in cancelled') {
      console.warn('Cognito logout window closed before redirect')
      return
    }
    throw error
  }
}

export async function exchangeCodeForTokens(
  cognitoConfig: CognitoConfig,
  code: string,
  codeVerifier: string
): Promise<CognitoTokens> {
  const body = buildTokenExchangeBody(cognitoConfig, code, codeVerifier)
  const res = await fetch(`${cognitoConfig.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed: ${res.status} ${text}`)
  }
  return res.json()
}

export async function refreshCognitoTokens(
  refreshToken: string
): Promise<CognitoTokens> {
  const cognitoConfig = getCognitoConfig()
  const body = buildRefreshTokenBody(cognitoConfig, refreshToken)
  const res = await fetch(`${cognitoConfig.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`)
  }
  return res.json()
}
