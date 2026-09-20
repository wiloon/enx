#!/usr/bin/env bash
# Runtime-config smoke test for enx-ui.
#
# enx-ui is built ONCE and configured at runtime (see src/lib/runtimeEnv.ts):
# the Clerk publishable key, extension id, API host and site URL come from the
# container's environment, never from `next build`. Unit tests cannot see a
# regression here -- a stray build-time fallback (e.g. clerkMiddleware()
# reading NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) works on any machine that has a
# .env file and only dies in the real image. That is how 42b5b8b took the
# homelab site down ("Missing publishableKey" on every request -> 500 -> 503).
#
# This script starts the PRODUCTION server with ONLY runtime variables and
# checks that a request to / succeeds and that the values it was given are the
# ones being served. The key and extension id are deliberately fake and
# distinctive, so they cannot come from a developer's .env.local.
#
# Modes:
#   scripts/smoke-runtime.sh                       # run .next/standalone (run `pnpm build` first)
#   SMOKE_IMAGE=enx-ui:smoke scripts/smoke-runtime.sh   # run a built container image (CI)
#
# Env: SMOKE_PORT (default 3999), SMOKE_TIMEOUT seconds to wait for the server
# (default 120), CONTAINER_CLI (docker|podman, image mode only).
set -euo pipefail

PORT="${SMOKE_PORT:-3999}"
TIMEOUT="${SMOKE_TIMEOUT:-120}"
URL="http://127.0.0.1:${PORT}/"

# A Clerk publishable key is "pk_test_" + base64("<frontend-api-host>$").
PK="pk_test_$(printf '%s$' 'smoke-test.clerk.accounts.dev' | base64 | tr -d '=\n')"
SK="sk_test_smoke_placeholder_not_a_real_key"
EXT_ID="smokesmokesmokesmokesmokesmokesm"
API_BASE_URL="https://api.smoke.invalid"
SITE_URL="https://smoke.invalid"

LOG="$(mktemp)"
BODY="$(mktemp)"
PID=""
CID=""
CLI="${CONTAINER_CLI:-}"

cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  [ -n "$CID" ] && "$CLI" rm -f "$CID" >/dev/null 2>&1 || true
  rm -f "$LOG" "$BODY"
}
trap cleanup EXIT

fail() {
  echo "❌ smoke: $*" >&2
  echo "----- server log -----" >&2
  if [ -n "$CID" ]; then "$CLI" logs "$CID" >&2 2>&1 || true; else cat "$LOG" >&2; fi
  exit 1
}

if [ -n "${SMOKE_IMAGE:-}" ]; then
  if [ -z "$CLI" ]; then
    CLI="$(command -v docker || command -v podman || true)"
    [ -n "$CLI" ] || { echo "❌ smoke: SMOKE_IMAGE set but neither docker nor podman found" >&2; exit 1; }
  fi
  echo "▶ smoke: image ${SMOKE_IMAGE} (runtime env only)"
  CID="$("$CLI" run -d -p "127.0.0.1:${PORT}:3000" \
    -e CLERK_PUBLISHABLE_KEY="$PK" -e CLERK_SECRET_KEY="$SK" \
    -e API_BASE_URL="$API_BASE_URL" -e SITE_URL="$SITE_URL" \
    -e ENX_EXTENSION_ID="$EXT_ID" \
    "$SMOKE_IMAGE")"
else
  cd "$(dirname "$0")/.."
  [ -f .next/standalone/server.js ] || { echo "❌ smoke: .next/standalone/server.js missing -- run 'pnpm build' first" >&2; exit 1; }
  echo "▶ smoke: .next/standalone (runtime env only, scrubbed environment)"
  # `env -i` + a cwd without any .env file: nothing but the variables below.
  # HOSTNAME is left unset on purpose: pinning it to 127.0.0.1 makes Next's
  # internal same-origin proxy fail (500 / connection refused) -- a quirk of
  # this harness, not of the app.
  (cd .next/standalone && exec env -i PATH="$PATH" HOME="${HOME:-/tmp}" \
    NODE_ENV=production PORT="$PORT" \
    CLERK_PUBLISHABLE_KEY="$PK" CLERK_SECRET_KEY="$SK" \
    API_BASE_URL="$API_BASE_URL" SITE_URL="$SITE_URL" \
    ENX_EXTENSION_ID="$EXT_ID" \
    node server.js) >"$LOG" 2>&1 &
  PID=$!
fi

# Wait for the first successful response. A 5xx is kept polling only until the
# deadline: a server that is up but broken must fail, not hang.
code="000"
deadline=$((SECONDS + TIMEOUT))
while [ "$SECONDS" -lt "$deadline" ]; do
  if [ -n "$PID" ] && ! kill -0 "$PID" 2>/dev/null; then
    fail "server exited before answering"
  fi
  code="$(curl -s -o "$BODY" -w '%{http_code}' -m 10 "$URL" || true)"
  [ "$code" = "200" ] && break
  sleep 1
done

[ "$code" = "200" ] || fail "GET / returned HTTP ${code} after ${TIMEOUT}s (want 200)"

# The extension id proves the runtime-env script serves the container's values;
# the key proves ClerkProvider (and, by 200, the middleware) used the runtime key.
grep -q "\"ENX_EXTENSION_ID\":\"${EXT_ID}\"" "$BODY" \
  || fail "HTML does not carry the runtime ENX_EXTENSION_ID (build-time value served?)"
grep -q "$PK" "$BODY" \
  || fail "HTML does not carry the runtime CLERK_PUBLISHABLE_KEY"

if [ -z "$CID" ] && grep -q "Missing publishableKey" "$LOG"; then
  fail "server logged 'Missing publishableKey' even though / answered"
fi

echo "✅ smoke: GET / -> 200, runtime key and extension id served"

# The API relay must follow the container's API_BASE_URL, not a value frozen at
# build time (next.config rewrites() froze it once: production would have
# relayed to the homelab API). The host is unresolvable, so the request fails;
# what matters is which host the server tried.
curl -s -o /dev/null -m 15 "http://127.0.0.1:${PORT}/api/smoke-relay-check" || true
server_log() { if [ -n "$CID" ]; then "$CLI" logs "$CID" 2>&1; else cat "$LOG"; fi; }
for _ in 1 2 3 4 5 6 7 8 9 10; do
  server_log | grep -q "api.smoke.invalid" && break
  sleep 1
done
server_log | grep -q "api.smoke.invalid" \
  || fail "/api/* was not relayed to the runtime API_BASE_URL (${API_BASE_URL}); target is frozen at build time"

echo "✅ smoke: /api/* relayed to the runtime API_BASE_URL"
