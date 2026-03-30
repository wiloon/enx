# Project Instructions for AI Agents

## Language Requirements

Use **English** for all code, comments, documentation, and configuration files to maintain consistency across the project.

## Code Conventions

- Follow existing code style and conventions in each sub-project
- Maintain consistency with existing patterns
- Test changes locally before committing
- Ensure proper `.gitignore` rules for generated files

## Architecture and Design Patterns

### Domain-Driven Design (DDD) Principles

When creating or updating code, follow DDD best practices to maintain clean architecture:

#### 1. Layer Separation

```
enx-api/
├── handlers/      # HTTP handlers (presentation layer)
├── enx/          # Domain logic and entities
├── repo/         # Repository pattern (data access)
├── utils/        # Shared utilities
└── middleware/   # Cross-cutting concerns
```

**Rules:**
- **Handlers** should only handle HTTP concerns (request/response, validation)
- **Domain layer** (`enx/`) contains business logic and entities
- **Repository** (`repo/`) handles all database operations
- Never put business logic in handlers or repositories

#### 2. Repository Pattern

**Purpose:** Abstract data access from business logic

**Guidelines:**
- Create repository interfaces in the domain layer
- Implement repositories in the `repo/` package
- Repository methods should return domain entities, not database models
- Use descriptive method names: `GetUserByID`, `FindActiveWords`, `SaveUserDict`

**Example:**
```go
// enx/user_repository.go (interface)
type UserRepository interface {
    GetByID(id string) (*User, error)
    GetByName(name string) (*User, error)
    Create(user *User) error
    Update(user *User) error
}

// repo/user_repo.go (implementation)
type userRepository struct {
    db *gorm.DB
}

func NewUserRepository(db *gorm.DB) enx.UserRepository {
    return &userRepository{db: db}
}
```

#### 3. Service Layer

**Purpose:** Encapsulate business logic and orchestrate operations

**Guidelines:**
- Create services in the domain layer (`enx/` package)
- Services coordinate between repositories and contain business rules
- Keep services focused on a single domain concept
- Services should be testable without database (use repository interfaces)

**Example:**
```go
// enx/user_service.go
type UserService struct {
    repo UserRepository
}

func (s *UserService) RegisterUser(name, email, password string) (*User, error) {
    // Business logic here
    // Password hashing, validation, etc.
    // Then use repository to persist
}
```

#### 4. Domain Entities

**Purpose:** Represent core business concepts

**Guidelines:**
- Define entities in the domain layer (`enx/` package)
- Entities should have behavior, not just data (methods that express domain operations)
- Keep database concerns separate (use separate structs for DB models if needed)
- Entities should be independent of frameworks (GORM, HTTP, etc.)

**Example:**
```go
// enx/user.go
type User struct {
    ID        string
    Name      string
    Email     string
    Password  string
    CreatedAt time.Time
    UpdatedAt time.Time
}

// Domain behavior
func (u *User) IsPasswordValid(password string) bool {
    // Business logic for password validation
}

func (u *User) UpdateLastLogin() {
    u.LastLoginTime = time.Now()
}
```

#### 5. Value Objects

**Purpose:** Immutable objects defined by their attributes

**Guidelines:**
- Use value objects for concepts without identity (e.g., Address, Email, PhoneNumber)
- Make them immutable
- Include validation in constructor
- Prefer value objects over primitive types for domain concepts

**Example:**
```go
// enx/email.go
type Email struct {
    value string
}

func NewEmail(email string) (Email, error) {
    if !isValidEmail(email) {
        return Email{}, errors.New("invalid email format")
    }
    return Email{value: email}, nil
}

func (e Email) String() string {
    return e.value
}
```

#### 6. Dependency Injection

**Guidelines:**
- Use constructor functions to inject dependencies
- Prefer interfaces over concrete types
- Make dependencies explicit in constructors

**Example:**
```go
// handlers/user_handler.go
type UserHandler struct {
    userService *enx.UserService
    logger      *zap.Logger
}

func NewUserHandler(userService *enx.UserService, logger *zap.Logger) *UserHandler {
    return &UserHandler{
        userService: userService,
        logger:      logger,
    }
}
```

#### 7. Testing Strategy

**Unit Tests:**
- Test domain logic without database
- Use mock repositories (interfaces make this easy)
- Test services independently

**Integration Tests:**
- Test repositories with real database
- Test full request flow through handlers
- Use `//go:build integration` tag

**Example:**
```go
// enx/user_service_test.go (unit test)
func TestUserService_RegisterUser(t *testing.T) {
    mockRepo := &MockUserRepository{}
    service := NewUserService(mockRepo)
    // Test business logic without database
}

// repo/user_repo_integration_test.go
//go:build integration

func TestUserRepository_Create(t *testing.T) {
    // Test with real database
}
```

### When to Apply DDD

- ✅ **Use DDD for:** New features, refactoring existing code, complex business logic
- ✅ **Repository Pattern:** All database operations
- ✅ **Service Layer:** Multi-step operations, business rules
- ⚠️ **Keep simple things simple:** Don't over-engineer trivial CRUD operations
- ⚠️ **Pragmatic approach:** Adapt patterns to project needs, not dogma

## Testing Requirements

### Core Rule

**Any code change that modifies functional behavior MUST include or update automated tests.**

**When creating a new function or modifying an existing one, you MUST write or update the corresponding unit test.** This applies to all layers: handlers, services, domain logic, utilities, and repositories.

This is a non-negotiable requirement. Manual testing is acceptable as a supplement for exploratory or UI-visual checks, but it cannot substitute for automated tests. Automated tests:

- Run repeatedly without human effort
- Catch regressions automatically in future changes
- Serve as living documentation of expected behavior
- Enforce correctness continuously, not just at the moment of writing

### What Counts as a "Functional Change"

These changes **require** test coverage:

| Change Type | Requires Tests |
|---|---|
| New feature or behavior | ✅ Yes |
| Bug fix | ✅ Yes — add a test that would have caught the bug |
| Refactoring with behavior change | ✅ Yes |
| New DOM filter / exclusion rule (e.g. `content.ts`) | ✅ Yes — add unit test in `__tests__/` |
| New API endpoint or handler | ✅ Yes |
| New business logic in service/domain layer | ✅ Yes |
| Pure refactoring with no behavior change | ⚠️ Optional, but recommended |
| Config or build file changes | ❌ Not required |
| Documentation-only changes | ❌ Not required |

### Test Type Selection Guide

Choose the appropriate test type based on what is being changed:

| Scenario | Test Type | Rationale |
|---|---|---|
| Pure logic function (no I/O, no DOM) | Unit test | Fast, isolated, easiest to write |
| DOM manipulation / HTML rendering | Unit test (jsdom) | JSDOM simulates browser environment |
| Repository / database query | Integration test | Must test against a real DB schema |
| Full HTTP request/response flow | Integration test | Validates handler + service + repo together |
| Chrome extension end-to-end behavior | E2E test (Playwright) | Requires real browser extension context |
| UI component interaction | E2E test (Playwright) or unit | Depends on complexity |

**When in doubt: start with a unit test.** Add integration or E2E tests when the unit test cannot adequately verify the behavior.

### Test Commands by Sub-Project

#### enx-api (Go)

```bash
task test              # Unit tests only (fast, no database required)
task test-integration  # Integration tests (requires database + config)
task test-all          # Unit + integration tests
task test-coverage     # Generate HTML coverage report
task test-pkg PKG=./enx  # Test a specific package
```

Use `//go:build integration` tag for integration test files.
See [enx-api/TESTING.md](../enx-api/TESTING.md) for full details.

#### enx-chrome (TypeScript)

```bash
task test          # Jest unit tests (jsdom environment)
task test-watch    # Jest in watch mode during development
task test-coverage # Coverage report
task test-e2e      # Playwright E2E tests (real Chrome + extension)
task test-all      # Unit + E2E tests
```

Unit tests live in `src/content/__tests__/`. Add new test files there.
See [enx-chrome/E2E_TESTING.md](../enx-chrome/E2E_TESTING.md) for E2E setup.

#### enx-ui (TypeScript / Next.js)

```bash
pnpm test        # Jest unit tests
pnpm test:watch  # Jest in watch mode
```

Unit tests live in `src/lib/__tests__/`.

#### enx-sync (Go)

```bash
go test ./...          # All tests
go test ./internal/... # Specific package tree
```

### Writing Tests: Key Principles

1. **Test the behavior, not the implementation.** Assert on outputs and side effects, not internal state.
2. **One test per scenario.** Each `it()` / `Test*` function should verify exactly one behavior.
3. **Name tests descriptively.** The test name should explain what is being tested and what the expected outcome is.
   - ✅ `should NOT highlight words inside <code>`
   - ❌ `test1` or `highlightTest`
4. **Reproduce bugs as tests first.** Before fixing a bug, write a failing test that demonstrates it. Fix the code until the test passes.
5. **Use table-driven tests for multiple scenarios** (Go) or `describe`/`it` blocks (TypeScript).

### Verification Step

Before marking any task as complete:

1. Run the relevant test command for the sub-project.
2. Confirm all tests pass.
3. If a new test was added, confirm it actually fails without the implementation change (i.e., the test is not vacuously passing).

## Logging Guidelines

### Logging Principles

**Purpose:** Logs should be actionable, searchable, and maintainable. Follow cloud-native logging best practices.

#### Log Levels

Use appropriate log levels consistently:

| Level | Usage | Examples |
|-------|-------|----------|
| **Debug** | Development details, verbose internal state | `logger.Debugf("📋 Headers: %v", headers)` |
| **Info** | Normal operations, important events | `logger.Infof("🔵 POST /api/login from 192.168.1.1")` |
| **Warn** | Recoverable issues, degraded functionality | `logger.Warnf("⚠️  Retry attempt 2/3 for API call")` |
| **Error** | Errors requiring attention | `logger.Errorf("❌ Database connection failed: %v", err)` |
| **Fatal** | Unrecoverable errors (app will exit) | `logger.Fatalf("💥 Failed to start server: %v", err)` |

#### Log Format Standards

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

#### Emoji Guidelines

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

#### Context and Structure

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

#### HTTP Request/Response Logging

**Request logging:**
```go
logger.Infof("🔵 %s %s from %s", method, path, clientIP)
logger.Debugf("📋 Headers: X-Session-ID='%s', Content-Type='%s'", 
    sessionID, contentType)
```

**Response logging:**
```go
logger.Infof("✅ %d %s %s", status, method, path)
logger.Debugf("📤 Response headers: %+v", headers)
```

**Error logging:**
```go
logger.Errorf("❌ %s %s failed: %v", method, path, err)
```

#### Sensitive Data

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

#### Performance Considerations

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

#### Consistency

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

## Documentation Guidelines

### Location

Place documentation files in the appropriate `docs/` directory:

| Project | Path | Content |
|---------|------|---------|
| enx-api | `enx-api/docs/` | API docs, deployment guides, architecture |
| enx-chrome | `enx-chrome/docs/` | Extension docs, user guides, development |
| enx-ui | `enx-ui/docs/` | UI docs, component guides, design |
| Root | `docs/` | Project-wide documentation |

Root-level markdown files (README.md, LICENSE, etc.) should only be used for project-wide documentation.

### Document Information Header

When creating or editing documentation files, include a "Document Information" table at the beginning:

```markdown
## Document Information

| Field | Value |
|-------|-------|
| **Created** | YYYY-MM-DD |
| **Last Updated** | YYYY-MM-DD |
| **Author** | author-name |
| **AI Assisted** | Yes/No (Tool Name) |
| **AI Model** | Model Name |
| **Status** | Draft/Proposed/Approved/Deprecated |
| **Version** | 0.1.0 |
```

## Project Structure

This is a monorepo with the following sub-projects:

- **enx-api** - Go backend API server (SQLite database)
- **enx-chrome** - Chrome extension (TypeScript, Vite)
- **enx-ui** - Next.js web UI
- **enx-sync** - P2P data sync service (Go)
- **mock-api** - Mock API server for testing

## Development Commands

Use Taskfile for consistent task execution:

```bash
# Root level
task dev-all      # Start all services
task test         # Run all unit tests
task test-all     # Run unit + integration tests

# Sub-projects
cd enx-api && task dev
cd enx-chrome && task dev
cd enx-ui && task dev
```

## Recording AI Contributions

When making significant contributions, update `AGENTS.md` with:

1. Date and task description
2. Problem statement
3. Solution overview
4. Files created/modified
5. Key benefits

## ENX Chrome Extension: Adding New Website Support

For detailed workflow instructions, see:

**📖 [.ai/workflows/adding-website-support.md](.ai/workflows/adding-website-support.md)**

Quick summary:
1. Add domain to `manifest.json` → `content_scripts.matches`
2. Inspect website to identify article container CSS selector
3. Add selector to `content.ts` → `getArticleNode()` method
4. Test: rebuild, reload extension, verify on target website
