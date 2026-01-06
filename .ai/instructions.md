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
