# Email Registration Design

## Overview

This document describes the design for email-based user registration in ENX. The current implementation stores username and password directly to the database without email verification. The new flow adds an optional email verification step: users can use the application immediately after registration, but a persistent reminder banner is shown until they verify their email. The only functional restriction for unverified users is a warning on the password reset page.

## User Flow

```
User fills in registration form (Chrome extension)
       ↓
POST /api/register
Creates a pending account, sends activation email, auto-logs in
       ↓
Chrome extension shows persistent activation reminder banner
(user can use all features normally)
       ↓
         ┌───────────────────────────────────────┐
         │                                       │
  User clicks link in email            User ignores (no deadline)
  (opens enx-ui /verify-email)                  │
         │                             Banner keeps showing
enx-ui calls GET /api/verify-email     Password reset shows warning
         │
Status → active, banner disappears
```

---

## Database Changes

### Migration file

`enx-api/migrations/20260328_add_email_verification.sql`

Add five columns to the `users` table:

| Column | Type | Description |
|---|---|---|
| `status` | `TEXT` | `pending` or `active`, default `pending` |
| `verification_token` | `TEXT` | Email activation token (32-byte random hex) |
| `token_expires_at` | `DATETIME` | Activation token expiry, 48 hours from issue |
| `reset_token` | `TEXT` | Password reset token (32-byte random hex) |
| `reset_token_expires_at` | `DATETIME` | Password reset token expiry, 1 hour from issue |

Existing users are migrated to `status = 'active'` with all token fields NULL.

---

## Configuration Changes

The project uses Viper with a layered priority (highest to lowest):

1. **Environment variables** — used in production / Kubernetes
2. **TOML config file** (`config.toml`) — local development defaults
3. **Viper `SetDefault` values** — fallback if neither of the above is set

New config keys to add in `enx-api/utils/viper.go` (`BindEnv` + `SetDefault`)
and `config.toml` (local defaults):

| Config key | Env var | Default |
|---|---|---|
| `resend.api-key` | `RESEND_API_KEY` | *(empty — must be set via `.env` locally and env var in production)* |
| `resend.from` | `RESEND_FROM` | `ENX <no-reply@wiloon.com>` |
| `app.frontend-base-url` | `APP_FRONTEND_BASE_URL` | `https://enx-ui-lab.wiloon.com` (dev) |

`resend.api-key` must never be committed to the repository. Set it via
`RESEND_API_KEY` in `.env` for local development (`.env` is already in
`.gitignore`) and via an OS environment variable / Kubernetes Secret in
production.

---

## Backend Changes (`enx-api`)

### New package: `enx-api/email/email.go`

Sends email via the [Resend](https://resend.com) HTTP API using the existing
`go-resty` client — no new external dependencies required.

**Exported functions:**

```go
// SendVerificationEmail sends an HTML activation email via the Resend API.
// The activation link is built as: {frontend-base-url}/verify-email?token={token}
func SendVerificationEmail(to, username, token string) error

// SendPasswordResetEmail sends an HTML password reset email via the Resend API.
// The reset link is built as: {frontend-base-url}/reset-password?token={token}
func SendPasswordResetEmail(to, username, token string) error
```

**Request the function makes:**

```
POST https://api.resend.com/emails
Authorization: Bearer {RESEND_API_KEY}
Content-Type: application/json

{
  "from": "{resend.from}",
  "to": ["user@example.com"],
  "subject": "Activate your ENX account",
  "html": "<p>Hi {username}, click <a href='{link}'>here</a> to activate your account. The link expires in 48 hours.</p>"
}
```

### `enx/user.go` — User struct changes

Add three fields to the `User` struct:

```go
type User struct {
    Id                    string
    Name                  string
    Email                 string
    Password              string    `json:"-"`
    Status                string    // "pending" | "active"
    VerificationToken     string    `json:"-"`
    TokenExpiresAt        time.Time `json:"-"`
    ResetToken            string    `json:"-"`
    ResetTokenExpiresAt   time.Time `json:"-"`
    CreateTime            time.Time
    UpdateTime            time.Time
    LastLoginTime         time.Time
}
```

### API endpoint changes (`enx-api/enx-api.go`)

#### `POST /api/register` (modified)

| Step | Change |
|---|---|
| Create user | Write `status=pending`, generate `verification_token` (crypto/rand 32-byte hex), set `token_expires_at = now + 48h` |
| After create | Call `email.SendVerificationEmail()`. On send failure, log the error but do not roll back the registration |
| Auto-login | Create a session immediately (same as the current auto-login behavior) |
| Response | Include `status: "pending"` and `session_id` so the extension shows the activation banner |

#### `GET /api/verify-email?token=xxx` (new)

1. Look up the user by `verification_token`
2. Check `token_expires_at > now`
3. Set `status = active`, clear `verification_token` and `token_expires_at` (single use)
4. Return JSON

Response schema:

```json
{ "success": true }
{ "success": false, "message": "..." }
```

Error cases:

| Case | HTTP | message |
|---|---|---|
| Token not found | 400 | `"Invalid activation link."` |
| Token expired | 400 | `"Activation link has expired. Please request a new one."` |
| Already active | 200 | `"Account already activated."` |

Token expiry only invalidates the link — the account remains intact and the
user continues to have access. The enx-ui error page shows a "Resend activation
email" button to let the user get a fresh link.

#### `POST /api/resend-verification` (new)

Request: `{ "email": "user@example.com" }`

Logic: find the account by email (any status), generate a new token, set
`token_expires_at = now + 48h`, resend the email.

**Security:** always return `{ "success": true }` regardless of whether the
email exists in the database (prevents user enumeration).

**Rate limiting:** allow at most one resend per email address per 60 seconds.
Track last-sent timestamps in an in-memory map (or Redis, which is already a
project dependency).

#### `POST /api/login` (modified)

Allow `pending` users to log in normally. Include `status` in the login response
so the Chrome extension knows whether to show the activation reminder:

```json
{ "success": true, "session_id": "...", "status": "pending" }
{ "success": true, "session_id": "...", "status": "active" }
```

No changes to login rejection logic — `pending` users log in normally.

#### `GET /api/me` (new)

Requires a valid session (`X-Session-ID` header). Returns the current user's
public fields including `status`.

Response:

```json
{ "id": "...", "name": "...", "email": "...", "status": "pending" }
```

Used by the Chrome extension on every popup open to check whether to show the
activation banner. If no session exists, skip the call entirely — do not send
a request that will return 401.

### Password reset flow

#### `POST /api/forgot-password` (new)

Request: `{ "email": "user@example.com" }`

Logic:
1. Look up user by email
2. Generate `reset_token` (crypto/rand 32-byte hex), set `reset_token_expires_at = now + 1h`
3. Call `email.SendPasswordResetEmail()`. Reset link: `{frontend-base-url}/reset-password?token={token}`
4. If user `status = pending`, include a warning in the response

**Security:** always return `{ "success": true }` regardless of whether the
email exists (prevents user enumeration). On send failure, log the error.

**Rate limiting:** at most one reset email per address per 60 seconds.

Response:

```json
{ "success": true }
{ "success": true, "warning": "Your email address has not been verified. The reset email may not be delivered if the address is incorrect." }
```

#### `POST /api/reset-password` (new)

Request: `{ "token": "xxx", "password": "newpassword" }`

Logic:
1. Look up user by `reset_token`
2. Check `reset_token_expires_at > now`
3. Hash new password with bcrypt
4. Update `password`, clear `reset_token` and `reset_token_expires_at`
5. Return `{ "success": true }`

Error cases:

| Case | HTTP | message |
|---|---|---|
| Token not found | 400 | `"Invalid reset link."` |
| Token expired | 400 | `"Reset link has expired. Please request a new one."` |

---

## Frontend Changes

### `enx-ui` — existing home page (modified)

The root page (`/`) already exists and renders `AuthWrapper`, which shows
`LoginForm` when unauthenticated and a dashboard when authenticated. The
following changes are needed:

**`src/components/LoginForm.tsx` (modified):**
- **Registration:** the form already collects username, email, and password.
  After successful registration the API now returns `status: "pending"` alongside
  `session_id`. Store both in auth state and redirect to the dashboard.
- **Dashboard (`AuthWrapper`):** if the logged-in user's `status === "pending"`,
  show the same activation banner as in the Chrome extension: "Your email is not
  verified. Verify now to enable password reset. [Resend email]"
- **Login form:** add a "Forgot password?" link that navigates to
  `/forgot-password`.

**`src/hooks/useAuth.ts` (modified):**
- Include `status` in the auth atom so all components can read it.
- On mount, call `/api/me` if a session exists to get the latest `status`.

---

### `enx-ui` — new pages

#### `src/app/verify-email/page.tsx`

Route: `/verify-email?token=xxx`

Behaviour:

1. On mount, read the `token` query parameter from the URL
2. Call `GET /api/verify-email?token=xxx`
3. Render one of three states:

| State | UI |
|---|---|
| Loading | Spinner + "Verifying your account…" |
| Success | Green checkmark + "Account activated! Open the ENX extension and log in." |
| Error | Error icon + message from API + "Resend activation email" button (calls `/api/resend-verification`) |

#### `src/app/forgot-password/page.tsx`

Route: `/forgot-password`

Behaviour:

1. Show a form with a single email field
2. On submit, call `POST /api/forgot-password`
3. Always show: "If an account with that email exists, a reset link has been sent."
4. If response includes `warning`, show it below the success message

#### `src/app/reset-password/page.tsx`

Route: `/reset-password?token=xxx`

Behaviour:

1. On mount, read the `token` query parameter
2. Show a form with new password + confirm password fields
3. On submit, call `POST /api/reset-password` with `{ token, password }`
4. On success: show "Password updated!" with two actions:
   - "Log in" button — navigates to `/` (for web users)
   - "Open ENX extension" note — prompts extension users to log in there
5. On error: show message from API

All three pages use the existing shadcn/ui `Card` component.

### `enx-chrome` — `src/components/Login.tsx` and main UI (modified)

- **After successful registration:** keep the existing auto-login behavior.
  After login, if the response includes `status: "pending"`, persist the status
  in `chrome.storage.local` (alongside `session_id`) and show the activation
  banner immediately.
- **Every popup open:** on mount, call `/api/me` to fetch the latest user state.
  Update `chrome.storage.local` with the returned `status`. If
  `status === "pending"`, show the activation banner. This ensures the banner
  disappears automatically the next time the user opens the popup after
  activating in enx-ui, with no extra user action required.
- **Activation banner:** displayed at the top of the extension UI whenever
  `status === "pending"`. Content: "Your email is not verified. Verify now to
  enable password reset. [Resend email]" — persistent, not dismissible,
  disappears only after activation.
- **After successful activation:** since `/api/me` is called on every popup
  open, no special handling is needed — the banner simply does not appear on
  the next open once the backend returns `status: "active"`.
- **Forgot password link:** a "Forgot password?" link on the login form opens
  `{frontend-base-url}/forgot-password` in a new browser tab via
  `chrome.tabs.create`. The entire password reset flow happens in enx-ui.

---

## Files Changed

| File | Change |
|---|---|
| `enx-api/migrations/20260328_add_email_verification.sql` | New migration: add status, verification_token, token_expires_at, reset_token, reset_token_expires_at |
| `enx-api/config.toml` | Add `[resend]` and `[app]` sections |
| `enx-api/utils/viper.go` | Add BindEnv + SetDefault for new config keys |
| `enx-api/enx/user.go` | Add Status, VerificationToken, TokenExpiresAt, ResetToken, ResetTokenExpiresAt fields |
| `enx-api/email/email.go` | New Resend HTTP sending module (verification + password reset emails) |
| `enx-api/enx-api.go` | Modify register/login; add /api/me, verify-email, resend-verification, forgot-password, reset-password routes |
| `enx-ui/src/components/LoginForm.tsx` | Add post-registration status handling, activation banner, "Forgot password?" link |
| `enx-ui/src/components/AuthWrapper.tsx` | Show activation banner when `status === "pending"` |
| `enx-ui/src/hooks/useAuth.ts` | Include `status` in auth state, call `/api/me` on mount |
| `enx-ui/src/app/verify-email/page.tsx` | New activation landing page |
| `enx-ui/src/app/forgot-password/page.tsx` | New forgot password page |
| `enx-ui/src/app/reset-password/page.tsx` | New reset password page |
| `enx-chrome/src/components/Login.tsx` | Add activation banner, "Forgot password?" link |

---

## Security

| Risk | Mitigation |
|---|---|
| Predictable token | `crypto/rand` 32-byte random hex for all tokens |
| Token reuse | Clear token fields immediately after use (single use) |
| Stale activation links | 48-hour expiry; expired links prompt resend — account unaffected |
| Stale reset links | 1-hour expiry; shorter window reduces exposure |
| User enumeration via forgot-password | Always return the same success response |
| User enumeration via resend | Always return the same success response |
| Email flooding | 60-second rate limit per address on resend and forgot-password endpoints |
| API key exposure | Injected via `.env` / environment variable, never committed |
