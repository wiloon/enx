#!/usr/bin/env node
/**
 * Homelab login smoke test -- no browser required.
 *
 * Exercises the same request chain the extension's Cognito login performs,
 * one layer at a time, so a failure points at a specific box:
 *
 *   1. enx-api reachable + TLS trusted           GET  {API}/api/version
 *   2. Cognito JWKS reachable FROM YOUR MACHINE   GET  {COGNITO_IDP}/.well-known/jwks.json
 *   3. Hosted UI + extension callback registered  GET  {HOSTED_UI}/oauth2/authorize -> /login
 *   4. CognitoAuth middleware is actually up      GET  {API}/api/me            -> expect 401 (503 = broken)
 *   5. Token validation rejects junk             GET  {API}/api/me  + garbage -> expect 401 "invalid token"
 *   6. (optional) real end-to-end auth            Cognito USER_PASSWORD_AUTH -> GET {API}/api/me -> expect 200
 *
 * Step 5 runs only when ENX_TEST_USERNAME + ENX_TEST_PASSWORD are set (a native
 * Cognito user, not Google), and needs ALLOW_USER_PASSWORD_AUTH on the app
 * client. Alternatively pass a token you already have via ENX_ACCESS_TOKEN.
 *
 * Usage:
 *   node scripts/homelab-smoke.mjs
 *   ENX_TEST_USERNAME=me@example.com ENX_TEST_PASSWORD='...' node scripts/homelab-smoke.mjs
 *   ENX_ACCESS_TOKEN=eyJ... node scripts/homelab-smoke.mjs
 *
 * Env overrides:
 *   ENX_API_BASE_URL      default https://enx-api.wiloon.lab
 *   COGNITO_REGION        default us-east-1
 *   COGNITO_USER_POOL_ID  default us-east-1_1GWBJVx85
 *   COGNITO_CLIENT_ID     default 645kitlgap7l1q4ebrfkmi9ltv   (the chrome app client)
 *   COGNITO_HOSTED_UI     default https://enx-auth.auth.us-east-1.amazoncognito.com
 *   ENX_EXTENSION_ID      default omcdpipnjffmblbhiphddcmoldceapam (from manifest "key")
 *   NODE_OPTIONS=--use-system-ca      trust the OS store (Wiloon Root CA lives there)
 */

const API = (
  process.env.ENX_API_BASE_URL || 'https://enx-api.wiloon.lab'
).replace(/\/$/, '')
const REGION = process.env.COGNITO_REGION || 'us-east-1'
const POOL_ID = process.env.COGNITO_USER_POOL_ID || 'us-east-1_1GWBJVx85'
const CLIENT_ID = process.env.COGNITO_CLIENT_ID || '645kitlgap7l1q4ebrfkmi9ltv'
const HOSTED_UI = (
  process.env.COGNITO_HOSTED_UI ||
  'https://enx-auth.auth.us-east-1.amazoncognito.com'
).replace(/\/$/, '')
const EXT_ID =
  process.env.ENX_EXTENSION_ID || 'omcdpipnjffmblbhiphddcmoldceapam'
const REDIRECT_URI = `https://${EXT_ID}.chromiumapp.org/callback`

const IDP = `https://cognito-idp.${REGION}.amazonaws.com`
const ISSUER = `${IDP}/${POOL_ID}`

let failures = 0
const pass = m => console.log(`  \x1b[32mPASS\x1b[0m ${m}`)
const fail = m => {
  failures++
  console.log(`  \x1b[31mFAIL\x1b[0m ${m}`)
}
const info = m => console.log(`  \x1b[90m${m}\x1b[0m`)
const head = m => console.log(`\n\x1b[1m${m}\x1b[0m`)

async function req(url, opts = {}) {
  try {
    const res = await fetch(url, opts)
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      /* not json */
    }
    return {
      ok: true,
      status: res.status,
      text,
      json,
      location: res.headers.get('location') || '',
    }
  } catch (e) {
    // Node wraps the real reason (DNS, TLS, ECONNREFUSED) in e.cause.
    const cause = e.cause || e
    const detail =
      [cause.code, cause.message].filter(Boolean).join(' ') || String(e)
    return { ok: false, error: { message: detail, code: cause.code } }
  }
}

// ---------------------------------------------------------------------------

head(`1. enx-api reachable  (${API})`)
{
  const r = await req(`${API}/api/version`)
  if (!r.ok) {
    fail(`GET /api/version -- ${r.error.message}`)
    if (
      String(r.error.message).match(
        /certificate|self-signed|SSL|TLS|UNABLE_TO_VERIFY/i
      )
    ) {
      info('Node does not read the OS trust store by default -- this may be')
      info('a Node artifact, not the real browser situation. Re-check with:')
      info('  NODE_OPTIONS=--use-system-ca node scripts/homelab-smoke.mjs')
      info(
        'If that still fails, the machine genuinely lacks the Wiloon Root CA;'
      )
      info('Chrome (Linux) reads ~/.pki/nssdb -- add it with certutil.')
    }
    if (String(r.error.message).match(/ENOTFOUND|EAI_AGAIN/)) {
      info(`DNS cannot resolve ${new URL(API).host} from this machine.`)
    }
  } else if (r.status === 200) {
    pass(`GET /api/version -> 200  ${r.text.slice(0, 120)}`)
  } else {
    fail(`GET /api/version -> ${r.status} (expected 200)`)
  }
}

head(`2. Cognito JWKS reachable from this machine  (${ISSUER})`)
{
  const r = await req(`${ISSUER}/.well-known/jwks.json`)
  if (!r.ok) {
    fail(`GET jwks.json -- ${r.error.message}`)
  } else if (r.status === 200 && r.json?.keys?.length) {
    pass(`GET jwks.json -> 200, ${r.json.keys.length} keys`)
    info(
      'The homelab enx-api pod also needs egress to this URL, or CognitoAuth stays down.'
    )
  } else {
    fail(`GET jwks.json -> ${r.status}`)
  }
}

head(`3. Cognito Hosted UI + extension callback  (${HOSTED_UI})`)
info(`redirect_uri = ${REDIRECT_URI}`)
{
  // The extension's launchWebAuthFlow loads exactly this. A registered
  // redirect_uri -> 302 to /login; an unregistered one -> 302 to
  // /error?error=redirect_mismatch. This is the check for the
  // "must be registered in Cognito callback URLs" error.
  const authorize =
    `${HOSTED_UI}/oauth2/authorize?response_type=code` +
    `&client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent('openid email profile')}` +
    `&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM` +
    `&code_challenge_method=S256`
  const r = await req(authorize, { redirect: 'manual' })
  if (!r.ok) {
    fail(`GET /oauth2/authorize -- ${r.error.message}`)
    info('Hosted UI unreachable from here. In a browser behind a CN proxy this')
    info('is the usual cause of "Authorization page could not be loaded".')
  } else if (/error=redirect_mismatch/.test(r.location)) {
    fail('authorize -> redirect_mismatch')
    info(`${REDIRECT_URI} is NOT in app client ${CLIENT_ID} callback URLs.`)
  } else if (/\/login\b/.test(r.location)) {
    pass('authorize -> /login  (callback registered)')
  } else if (r.status >= 300 && r.status < 400) {
    info(`authorize -> ${r.status} ${r.location || '(no Location header)'}`)
  } else {
    info(`authorize -> status ${r.status}; inspect manually:`)
    info(`  ${authorize}`)
  }

  const login = await req(authorize.replace('/oauth2/authorize?', '/login?'))
  if (login.ok && login.status === 200 && /password/i.test(login.text)) {
    pass('GET /login -> 200, renders the sign-in form')
    info('So the page the extension loads works from here. If the extension')
    info('still says "Authorization page could not be loaded", the failure is')
    info("in that browser's network path (proxy / GFW to *.amazoncognito.com).")
  } else if (login.ok) {
    fail(`GET /login -> ${login.status} (no sign-in form)`)
  } else {
    fail(`GET /login -- ${login.error.message}`)
  }
}

head('4. CognitoAuth middleware is up  (unauthenticated GET /api/me)')
{
  const r = await req(`${API}/api/me`)
  if (!r.ok) {
    fail(`GET /api/me -- ${r.error.message}`)
  } else if (r.status === 401) {
    pass(
      `GET /api/me (no token) -> 401  ${JSON.stringify(r.json ?? r.text.slice(0, 80))}`
    )
  } else if (r.status === 503) {
    fail(`GET /api/me -> 503 "auth service unavailable"`)
    info('CognitoAuth failed to initialise on the server. Likely causes:')
    info('  - homelab pod cannot reach the JWKS URL from step 2 (egress / DNS)')
    info(
      '  - cognito.region / user-pool-id / client-id unset in the pod config'
    )
  } else {
    fail(`GET /api/me -> ${r.status} (expected 401)`)
  }
}

head('5. Token validation rejects a bogus token')
{
  const r = await req(`${API}/api/me`, {
    headers: { Authorization: 'Bearer not.a.real.token' },
  })
  if (!r.ok) {
    fail(`GET /api/me -- ${r.error.message}`)
  } else if (r.status === 401) {
    pass(`GET /api/me (garbage token) -> 401  ${JSON.stringify(r.json ?? '')}`)
  } else {
    fail(`GET /api/me (garbage token) -> ${r.status} (expected 401)`)
  }
}

// ---------------------------------------------------------------------------

async function getAccessToken() {
  if (process.env.ENX_ACCESS_TOKEN) {
    info('using ENX_ACCESS_TOKEN from env')
    return process.env.ENX_ACCESS_TOKEN
  }
  const username = process.env.ENX_TEST_USERNAME
  const password = process.env.ENX_TEST_PASSWORD
  if (!username || !password) return null

  const r = await req(`${IDP}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  })
  if (!r.ok) {
    fail(`Cognito InitiateAuth -- ${r.error.message}`)
    return null
  }
  if (r.status !== 200) {
    fail(`Cognito InitiateAuth -> ${r.status}  ${r.text.slice(0, 200)}`)
    if (
      r.json?.__type === 'InvalidParameterException' &&
      /USER_PASSWORD_AUTH/i.test(r.text)
    ) {
      info(
        'Enable ALLOW_USER_PASSWORD_AUTH on the app client, or supply ENX_ACCESS_TOKEN instead.'
      )
    }
    if (r.json?.__type === 'NotAuthorizedException') {
      info(
        'Wrong username/password, or this is a Google-federated user (no native password).'
      )
    }
    return null
  }
  const tok = r.json?.AuthenticationResult?.AccessToken
  if (!tok) {
    fail(
      `Cognito InitiateAuth 200 but no AccessToken (challenge: ${r.json?.ChallengeName || 'none'})`
    )
    return null
  }
  return tok
}

head('6. Real end-to-end auth  (Cognito token -> GET /api/me -> 200)')
{
  const token = await getAccessToken()
  if (!token) {
    info(
      'skipped -- set ENX_TEST_USERNAME + ENX_TEST_PASSWORD, or ENX_ACCESS_TOKEN'
    )
  } else {
    const r = await req(`${API}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) {
      fail(`GET /api/me -- ${r.error.message}`)
    } else if (r.status === 200) {
      pass(`GET /api/me -> 200  ${JSON.stringify(r.json)}`)
    } else {
      fail(
        `GET /api/me (real token) -> ${r.status}  ${JSON.stringify(r.json ?? r.text.slice(0, 120))}`
      )
      if (r.status === 401) {
        info(
          "Token is valid at Cognito but rejected here. Check that the pod's"
        )
        info(
          "cognito.user-pool-id / client-id / chrome-client-id match the token's issuer & client_id."
        )
      }
    }
    // Hand the token to a follow-up Playwright run if wanted.
    if (r.ok && r.status === 200)
      console.log(`\n  export ENX_ACCESS_TOKEN='${token}'`)
  }
}

// ---------------------------------------------------------------------------

console.log('')
if (failures === 0) {
  console.log('\x1b[32mAll checks passed.\x1b[0m')
  process.exit(0)
} else {
  console.log(`\x1b[31m${failures} check(s) failed.\x1b[0m`)
  process.exit(1)
}
