# Homelab login testing

Two layers, cheapest first.

## 1. Browserless smoke test

```bash
node scripts/homelab-smoke.mjs                       # infra + middleware only
ENX_TEST_USERNAME=you@example.com \
ENX_TEST_PASSWORD='...' node scripts/homelab-smoke.mjs   # + real end-to-end auth
ENX_ACCESS_TOKEN=eyJ... node scripts/homelab-smoke.mjs   # if you already have a token
```

Walks the same request chain the extension performs, one hop at a time:

| Step | Check                                                   | A failure means                                                                                                           |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1    | `GET {API}/api/version`                                 | enx-api down, DNS, or **TLS cert not trusted**                                                                            |
| 2    | Cognito JWKS reachable from your machine                | (the homelab pod needs this egress too)                                                                                   |
| 3    | `/oauth2/authorize` (extension redirect_uri) → `/login` | `redirect_mismatch` = extension callback not in the app client; `/login` unreachable = proxy/GFW to `*.amazoncognito.com` |
| 4    | `GET /api/me` unauth → 401                              | `503` = CognitoAuth failed to init on the server (pod can't reach JWKS, or `cognito.*` config unset)                      |
| 5    | `GET /api/me` + junk token → 401                        | token validation misconfigured                                                                                            |
| 6    | Cognito `USER_PASSWORD_AUTH` → `GET /api/me` → 200      | `401` = pod's user-pool-id / client-id don't match the token                                                              |

Step 3 uses `ENX_EXTENSION_ID` (default `omcdpipnjffmblbhiphddcmoldceapam`, the
pinned-`key` ID). It is the check for the extension's
_"Authorization page could not be loaded … must be registered in Cognito callback
URLs"_ error — note that message is a **hardcoded hint** in `cognito.ts`, appended
whenever `launchWebAuthFlow` fails for _any_ reason. If step 3 passes here but the
extension still fails, the callback is fine and the real problem is that browser's
network path to Cognito (proxy / GFW), not Cognito config.

Step 6 needs `ALLOW_USER_PASSWORD_AUTH` on the Cognito app client and a **native**
(email+password) user — a Google-federated account can't be scripted. On success
it prints an `export ENX_ACCESS_TOKEN=...` line for use below.

## 2. Playwright E2E against the built extension

```bash
pnpm build                                            # dist/ → VITE_ENV=staging (enx-api.wiloon.lab)
ENX_HOMELAB=1 ENX_ACCESS_TOKEN=eyJ... pnpm test:e2e:homelab
```

`e2e/homelab-login.spec.ts`, all skipped unless `ENX_HOMELAB=1`:

- **extension ID matches pinned key** — prints the `https://<id>.chromiumapp.org/callback`
  URL that must be in the Cognito app client's callback list.
- **seeded token authenticates against enx-api.wiloon.lab** — seeds a real Cognito
  access token + `apiBaseUrl`, then drives `validateSession` through the service
  worker. This is the call that breaks on a misconfigured homelab.
- **popup shows the signed-in view** — UI-level assertion of the same.
- **interactive Cognito Hosted UI sign-in** — full `launchWebAuthFlow` against
  real Hosted UI. Off unless `ENX_OAUTH_LIVE=1`; needs `ENX_TEST_USERNAME` /
  `ENX_TEST_PASSWORD` (native user). Inherently flaky — keep it out of CI.
  Set `ENX_PROXY=http://127.0.0.1:7890` to route the whole browser (auth window
  included) through a proxy — this is how to confirm that a bare
  `launchWebAuthFlow` failing with _"Authorization page could not be loaded"_ is
  a proxy-coverage problem: it fails without `ENX_PROXY` and succeeds with it.

## Why the interactive flow is hard to automate

Login is `chrome.identity.launchWebAuthFlow` → AWS Cognito Hosted UI → PKCE code
exchange. Playwright's persistent context is real Chrome so `chrome.identity`
works and the Hosted UI window shows up as a new page you can fill in, but:

- Google federation is effectively unautomatable (bot detection).
- Chrome swallows the final `chromiumapp.org` redirect internally — assert on
  extension storage, not on a URL.
- Hosted UI markup changes (classic vs. new managed login) break selectors.

For anything but a rare manual check, seed a token (layer 1 → layer 2) instead of
driving Hosted UI.

## "Authorization page could not be loaded"

`cognito.ts` wraps _every_ `launchWebAuthFlow` failure with the hint _"…must be
registered in Cognito callback URLs"_ — ignore that clause, check the real prefix.
The callback is registered (smoke test step 3); the auth window genuinely could
not load `enx-auth.auth.us-east-1.amazoncognito.com`.

Seen from behind a homelab transparent proxy (WireGuard → xray tproxy). The auth
window is NOT a proxy-awareness problem there — tproxy catches it at L3 like any
other traffic. The culprit is **HTTP/3 (QUIC)**:

- A normal tab tries QUIC to Cognito, the UDP-over-proxy path is lossy, Chrome
  marks QUIC broken after a few seconds and **falls back to HTTP/2 over TCP** — so
  the page loads, just slowly.
- `launchWebAuthFlow`'s window has a hard load deadline and does not do that
  fallback dance → it just fails.

Fix (fastest → most thorough):

1. `chrome://flags/#enable-quic` → **Disabled**, relaunch. Or launch with
   `--disable-quic`.
2. Gateway: drop outbound UDP/443 so Chrome always falls straight to TCP
   (`iptables -A ... -p udp --dport 443 -j REJECT` before the TPROXY rule).
3. xray client routing: add `amazoncognito.com`, `amazonaws.com`, `cloudfront.net`
   to the explicit `proxy` domain rule (doesn't fix QUIC, but removes any
   dependency on SNI-sniffing / geoip for these).

Confirm which hop is failing on the proxy node: `tail -f {xray_log_dir}/access.log`
while clicking Sign in — look for `amazoncognito.com` and whether it routed
`[proxy]` or `[direct]`, plus UDP errors in `error.log`.

## TLS note

`*.wiloon.lab` is served with a leaf cert from the self-signed **Wiloon Root CA**
(subject `CN=*.wiloon.com`, `CA:TRUE`, no name constraints — it legitimately signs
`*.wiloon.lab`). The machine running Chrome must trust that root:

- **OpenSSL / curl / most CLIs** — `/etc/ssl/certs` via `update-ca-trust` / `trust`.
- **Chrome & Chromium on Linux** — their own NSS DB at `~/.pki/nssdb`, _not_ the
  system store: `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Wiloon Root CA" -i wiloon-ca.crt`
- **Node** — neither, by default; needs `NODE_OPTIONS=--use-system-ca` (Node ≥22).
  A bare `node scripts/homelab-smoke.mjs` failing step 1 with
  `UNABLE_TO_VERIFY_LEAF_SIGNATURE` is usually just this, not a real outage —
  re-run with `--use-system-ca` to confirm.

If Chrome's NSS DB lacks the root, every service-worker `fetch` to
`https://enx-api.wiloon.lab` fails (`net::ERR_CERT_AUTHORITY_INVALID` in the SW
Network tab; `TypeError: Failed to fetch` in JS) and login can't complete.
