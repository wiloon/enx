# enx-api logging reference

**Purpose:** Logs should be actionable, searchable, and maintainable. Follow cloud-native logging best practices.

## Log Levels

Use appropriate log levels consistently:

| Level | Usage | Examples |
|-------|-------|----------|
| **Debug** | Development details, verbose internal state | `logger.Debugf("📋 Headers: %v", headers)` |
| **Info** | Normal operations, important events | `logger.Infof("🔵 POST /api/login from 192.168.1.1")` |
| **Warn** | Recoverable issues, degraded functionality | `logger.Warnf("⚠️  Retry attempt 2/3 for API call")` |
| **Error** | Errors requiring attention | `logger.Errorf("❌ Database connection failed: %v", err)` |
| **Fatal** | Unrecoverable errors (app will exit) | `logger.Fatalf("💥 Failed to start server: %v", err)` |

## Log Format Standards

**✅ Modern Format (Recommended):**
```go
// Use emoji prefixes for visual scanning
logger.Infof("🔵 %s %s from %s", method, path, clientIP)
logger.Infof("✅ %d %s %s", status, method, path)
logger.Errorf("❌ Failed to connect to database: %v", err)
logger.Warnf("⚠️  Deprecated API endpoint called: %s", path)
logger.Debugf("📋 Request headers: %+v", headers)
```

**❌ Avoid (Old Style):**
```go
// Don't use ASCII art or excessive decoration
logger.Infof("=== Request Start ===")
logger.Infof("Request: POST /api/login")
logger.Infof("=== Request End ===")
```

## Emoji Guidelines

Use consistent emoji prefixes for quick visual identification:

| Emoji | Meaning | Usage |
|-------|---------|-------|
| 🔵 | Incoming request | HTTP request received |
| ✅ | Success | Successful operation/response |
| ❌ | Error | Error occurred |
| ⚠️ | Warning | Potential issue, degraded state |
| 📋 | Metadata | Headers, parameters |
| 🌐 | Network | External API calls, DNS |
| 💾 | Database | DB operations |
| 🔒 | Security | Auth, permissions |
| 🚀 | Startup | Service initialization |
| 🛑 | Shutdown | Service termination |
| ✈️ | CORS | CORS-related operations |
| 📤 | Outgoing | External requests |

## Context and Structure

**Include relevant context:**
```go
// ✅ Good - includes context
logger.Infof("🔵 POST /api/login from %s", c.ClientIP())
logger.Errorf("❌ Failed to save user (id=%s): %v", userID, err)

// ❌ Bad - missing context
logger.Infof("Request received")
logger.Errorf("Save failed: %v", err)
```

**Use structured fields for machine parsing:**
```go
// For production, consider structured logging
logger.With(
    zap.String("method", "POST"),
    zap.String("path", "/api/login"),
    zap.String("client_ip", clientIP),
    zap.Int("status", 200),
).Info("Request completed")
```

## HTTP Request/Response Logging

enx-api logs every request in **one structured line**, written by
`middleware.RequestLog` (registered in `setupRouter`) after the handler
returns:

```
2026-09-29 00:15:02.798	info	request	{"method": "GET", "route": "/api/word/:word", "status": 200, "duration_ms": 4.2, "user_id": "u1"}
```

- `route` is gin's route template, never the raw path: `/api/word/<word>`
  would put what the user looked up into the logs. Unmatched paths log as
  `unmatched`.
- The client IP is not logged (behind Cloudflare it is not the user's
  anyway), nor are headers.
- CORS preflights (`OPTIONS`) are not logged.
- Optional fields: `lookup_source` on a word lookup (ADR-040), and
  `rate_limited: true` on a request the per-user rate limit refused
  (ADR-060), which tells it from a quota 429.

Handlers do not log the request or response themselves; they log only
what the request line cannot show (a failed dependency, an admin action).
For other structured events use `logger.Infow(msg, "key", value, …)`.

**Error logging:**
```go
logger.Errorf("❌ %s %s failed: %v", method, path, err)
```

## Sensitive Data

**Never log:**
- Passwords (plaintext or hashed)
- API keys, tokens, secrets
- Credit card numbers, PII
- Session cookies (full content)

```go
// ❌ Bad - logs password
logger.Infof("User login attempt: %s/%s", username, password)

// ✅ Good - no sensitive data
logger.Infof("🔒 Login attempt for user: %s", username)
```

## Performance Considerations

**Avoid excessive logging:**
- Use `Debug` level for verbose internal state
- Don't log in tight loops without rate limiting
- Consider async logging for high-throughput systems

```go
// ❌ Bad - logs every iteration
for _, item := range items {
    logger.Debugf("Processing item: %v", item)
}

// ✅ Good - batched logging
logger.Debugf("📦 Processing %d items", len(items))
```

## Consistency

- Use consistent verb tenses (prefer present tense)
- Use consistent terminology across the codebase
- Group related logs with common prefixes (e.g., all DB ops use 💾)

**Example: Login Flow**
```go
logger.Infof("🔵 POST /api/login from %s", clientIP)
logger.Debugf("🔒 Authenticating user: %s", username)
logger.Debugf("💾 Querying user from database")
logger.Infof("✅ 200 POST /api/login - user authenticated")
```
