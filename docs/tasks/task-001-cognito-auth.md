# Task 001 — AWS Cognito Authentication Integration

## Goal

Replace the current hand-rolled username/password authentication in `enx-api` with AWS Cognito, enabling:

- Email/password login (via Cognito Hosted UI)
- Google OAuth login (via Cognito Hosted UI + Federated Identities)
- Extensible to other social providers (GitHub, etc.) in the future
- Consistent auth flow across enx-ui and enx-chrome using Hosted UI
- Removal of self-managed password hashing, verification tokens, and reset tokens

---

## Background

Currently `enx-api` implements auth entirely in-house:
- Password hashing via bcrypt (`utils/password`)
- Email verification tokens stored in SQLite
- Password reset tokens stored in SQLite
- Session management via JWT generated internally

After this task, Cognito handles all of the above. `enx-api` becomes a **resource server** that validates Cognito-issued JWTs.

---

## Behavior

### Registration and Login — enx-ui

| Step | Actor | Action |
|------|-------|--------|
| 1 | User | Clicks "Sign in" in enx-ui |
| 2 | enx-ui | Redirects browser to Cognito Hosted UI |
| 3 | User | Registers or logs in (email/password or Google) on Cognito-hosted page |
| 4 | Cognito | Redirects back to `https://enx-ui.wiloon.com/auth/callback` with auth code |
| 5 | enx-ui | Exchanges auth code for tokens (PKCE flow); stores `access_token` and `refresh_token` |
| 6 | enx-ui | Sends API requests with `Authorization: Bearer <access_token>` |
| 7 | enx-api | Validates JWT; auto-provisions local `User` row on first request |

### Registration and Login — enx-chrome

| Step | Actor | Action |
|------|-------|--------|
| 1 | User | Clicks "Sign in" in extension popup |
| 2 | enx-chrome | Calls `chrome.identity.launchWebAuthFlow` with Cognito Hosted UI URL |
| 3 | User | Registers or logs in (email/password or Google) in the managed popup |
| 4 | Cognito | Redirects to `https://<extension-id>.chromiumapp.org/callback` with auth code |
| 5 | Chrome | Captures redirect; hands auth code back to the extension |
| 6 | enx-chrome | Exchanges auth code for tokens (PKCE flow); stores tokens in `chrome.storage.local` |
| 7 | enx-chrome | Sends API requests with `Authorization: Bearer <access_token>`; replaces current `X-Session-ID` header |
| 8 | enx-api | Validates JWT; auto-provisions local `User` row on first request |

> **enx-api does NOT expose `/register` or `/login` endpoints after this change.**

### Token Validation (enx-api middleware)

1. Extract JWT from `Authorization: Bearer` header
2. Fetch Cognito JWKS (cached, refresh on key rotation)
3. Validate: signature, `iss` matches Cognito User Pool URL, `aud` matches App Client ID, `exp` not expired
4. Extract `sub` (Cognito user ID) and attach to request context
5. Auto-create local `User` row if `sub` not seen before

---

## Interface / Contract

### Removed endpoints

| Method | Path | Reason |
|--------|------|--------|
| `POST` | `/api/register` | Handled by Cognito |
| `POST` | `/api/login` | Handled by Cognito |
| `POST` | `/api/verify-email` | Handled by Cognito |
| `POST` | `/api/reset-password` | Handled by Cognito |

### Unchanged / kept endpoints

All existing word, paragraph, translate endpoints remain unchanged. They gain JWT auth enforcement via updated middleware.

### Cognito App Clients

Two separate App Clients must be created in the same User Pool:

| Client | Redirect URI | Used by |
|--------|-------------|--------|
| `enx-ui-client` | `https://enx-ui.wiloon.com/auth/callback` | enx-ui |
| `enx-chrome-client` | `https://<extension-id>.chromiumapp.org/callback` | enx-chrome |

Both clients use **PKCE** (no client secret). Both share the same User Pool, so a single Google identity can log in from either client.

### New middleware signature

```go
// middleware/cognito_auth.go
func CognitoAuth(cfg CognitoConfig) gin.HandlerFunc
```

`CognitoConfig`:
```go
type CognitoConfig struct {
    Region     string // e.g. "us-east-1"
    UserPoolID string // e.g. "us-east-1_XXXXXXX"
    ClientID   string // App Client ID (accepts tokens from either client)
}
```

Context key set after successful validation:
```go
c.Set("cognito_sub", sub)      // string — Cognito user UUID
c.Set("user_id", user.Id)      // string — local DB user UUID
```

### User table changes

| Column | Change |
|--------|--------|
| `password` | Remove |
| `verification_token` | Remove |
| `token_expires_at` | Remove |
| `reset_token` | Remove |
| `reset_token_expires_at` | Remove |
| `cognito_sub` | **Add** — unique, indexed, maps Cognito `sub` to local row |

Migration: `migrations/005_cognito_migration.sql`

---

## Validation Rules

- JWT must be present; missing → `401 Unauthorized`
- JWT must pass all validation checks; invalid/expired → `401 Unauthorized`
- `iss` must exactly match `https://cognito-idp.<region>.amazonaws.com/<userPoolId>`
- `aud` must match the configured App Client ID
- `exp` must be in the future (no clock skew tolerance beyond 5 seconds)

---

## Error Cases

| Scenario | HTTP Status | Response body |
|----------|-------------|---------------|
| Missing `Authorization` header | 401 | `{"error": "missing authorization header"}` |
| Malformed JWT | 401 | `{"error": "invalid token"}` |
| Expired token | 401 | `{"error": "token expired"}` |
| JWKS fetch failure | 503 | `{"error": "auth service unavailable"}` |
| Local user auto-provision fails | 500 | `{"error": "internal server error"}` |

---

## Configuration

New keys in `config.toml` (local dev defaults):

```toml
[cognito]
region       = "us-east-1"
user_pool_id = "us-east-1_XXXXXXX"
client_id    = "XXXXXXXXXXXXXXXXXXXXXXXX"
```

New `BindEnv` entries in `utils/viper.go` (following existing pattern):

```go
_ = viper.BindEnv("cognito.region",       "COGNITO_REGION")
_ = viper.BindEnv("cognito.user-pool-id", "COGNITO_USER_POOL_ID")
_ = viper.BindEnv("cognito.client-id",    "COGNITO_CLIENT_ID")
```

In k8s, these are injected via a ConfigMap or Secret and override `config.toml`:

```yaml
env:
  - name: COGNITO_REGION
    value: "us-east-1"
  - name: COGNITO_USER_POOL_ID
    valueFrom:
      secretKeyRef:
        name: enx-cognito
        key: user_pool_id
  - name: COGNITO_CLIENT_ID
    valueFrom:
      secretKeyRef:
        name: enx-cognito
        key: client_id
```

---

## Out of Scope (this task)

- Cognito User Pool / App Client Terraform/CDK provisioning (infrastructure)
- Google OAuth App setup in Google Cloud Console
- Refresh token handling in the API (clients manage their own refresh)
- GitHub or other additional social providers (future tasks)

## In Scope — Client Changes

### enx-ui
- Add `/auth/callback` route that exchanges auth code for tokens (PKCE)
- Store `access_token` and `refresh_token` (e.g. in memory + secure cookie)
- Add "Sign in" button that redirects to Cognito Hosted UI
- Add "Sign out" that clears tokens and redirects to Cognito logout endpoint
- Attach `Authorization: Bearer` header to all API requests

### enx-chrome
- Replace `X-Session-ID` with `Authorization: Bearer <access_token>` in `background.ts` and `api.ts`
- Replace current login form with `chrome.identity.launchWebAuthFlow` triggering Cognito Hosted UI
- Store `access_token` and `refresh_token` in `chrome.storage.local`
- Add token refresh logic (call Cognito token endpoint with refresh token when access token expires)
- Remove current session-based auth state from `atoms.ts`

---

## Decisions

1. **Local user record**: Keep the local `User` table. Keyed by `cognito_sub`. Used for per-user app data (word lists, dictionaries, etc.).
2. **Migration path**: No data migration. Existing users must re-register via Cognito. SQLite auth columns will be dropped.
3. **Dev environment**: Connect to a real AWS dev Cognito User Pool. No Localstack.
4. **Client flow**: Both `enx-ui` and `enx-chrome` use **Cognito Hosted UI**.
   - enx-ui: standard browser redirect with PKCE
   - enx-chrome: `chrome.identity.launchWebAuthFlow` with PKCE
   - All login methods (email/password, Google, future providers) go through the same Hosted UI page
   - `X-Session-ID` header in enx-chrome is replaced by `Authorization: Bearer <access_token>`
